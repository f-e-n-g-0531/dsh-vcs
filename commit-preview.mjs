// Internal preview capabilities and caller-serialized commit transaction.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {settledReads} from './src/settled-reads.mjs';
import {createHash} from 'node:crypto';
import {git} from './local-command.mjs';
import {inflateSync} from 'node:zlib';
import {publishCommitObjects} from './commit-object-publish.mjs';
import {compareAndSwapBranch} from './git-ref-cas.mjs';
import {withOperationBudget,currentOperationBudget} from './src/operation-budget.mjs';
import {parseGitIndex} from './src/git-index.mjs';
import {encodeGitCommit} from './src/git-commit-object.mjs';
import {createVerifiedIndexCommitPlan} from './src/verified-commit-plan.mjs';
import {createAmendPlan} from './src/amend-plan.mjs';

const INDEX=8*1024*1024,PARENT=2*1024*1024,CONFIG=256*1024;
// Only the exact issued public summary is a key; private plans never leave this module.
const previews=new WeakMap();
// Amend capabilities are deliberately unusable by normal commit consumers.
const amendPreviews=new WeakMap();
const hash=b=>createHash('sha256').update(b).digest('hex');
const decode=b=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
const check=()=>currentOperationBudget().throwIfExpired();
const fail=message=>Object.assign(new Error(message),{code:'vcs/commit-preview'});
const identity=s=>[s.dev,s.ino,s.birthtimeNs].map(String);
const version=s=>[...identity(s),s.size,s.mtimeNs,s.ctimeNs,s.mode].map(String);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const plain=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n;
function record(value,keys,label){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw fail('Invalid '+label+' record');
 const out={};for(const key of Reflect.ownKeys(value)){
  if(!keys.includes(key))throw fail('Unsupported '+label+' field');
  const d=Object.getOwnPropertyDescriptor(value,key);
  if(!d||!Object.hasOwn(d,'value'))throw fail(label+' requires own data properties');
  out[key]=d.value;
 }return out;
}
async function readPlain(file,max){
 check();const before=await fs.lstat(file,{bigint:true});
 if(!plain(before)||before.size>BigInt(max))throw fail('Expected bounded single-link regular file: '+file);
 const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const opened=await handle.stat({bigint:true});
  if(!plain(opened)||!equal(version(before),version(opened)))throw fail('Stale file opening');
  const bytes=Buffer.alloc(max+1);let length=0;
  while(length<bytes.length){check();const r=await handle.read(bytes,length,bytes.length-length,length);if(!r.bytesRead)break;length+=r.bytesRead;}
  const after=await handle.stat({bigint:true}),current=await fs.lstat(file,{bigint:true});
  if(length>max||!plain(current)||!equal(version(opened),version(after))||!equal(version(after),version(current))||BigInt(length)!==after.size)throw fail('Stale or oversized file reading');
  return {bytes:Buffer.from(bytes.subarray(0,length)),version:version(after)};
 }finally{await handle.close();}
}
async function exists(file){try{await fs.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
const forbidden=new Set(['commondir','gitdir','shallow','config.worktree','MERGE_HEAD','MERGE_MSG','CHERRY_PICK_HEAD','REVERT_HEAD','REBASE_HEAD','BISECT_LOG','BISECT_START','rebase-merge','rebase-apply','sequencer','worktrees','info/sparse-checkout','info/attributes','objects/info/alternates','objects/info/http-alternates'].map(s=>s.toLowerCase()));
async function metadata(directory){
 const rows=[];let nodes=0;
 async function visit(file,relative){
  check();if(++nodes>20000)throw fail('Metadata inspection limit exceeded');
  const key=relative.toLowerCase();
  if(forbidden.has(key)||key.endsWith('.lock')||key.endsWith('.promisor')||key.startsWith('sharedindex.')||key.startsWith('hooks/')&&!key.endsWith('.sample'))throw fail('Unsupported repository metadata: '+relative);
  const s=await fs.lstat(file,{bigint:true});
  if(s.isSymbolicLink()||(!s.isDirectory()&&!plain(s))||await fs.realpath(file)!==file)throw fail('Linked or special repository metadata');
  rows.push([relative,s.isDirectory()?identity(s):version(s)]);
  if(s.isDirectory()){
   const names=await fs.readdir(file);check();
   if(names.length>20000-nodes)throw fail('Metadata inspection limit exceeded');
   for(const name of names.sort())await visit(path.join(file,name),relative?relative+'/'+name:name);
  }
 }
 await visit(directory,'');return rows;
}
// Inspect names/types only, never read working file contents (including attributes).
async function workPolicy(root){
 let nodes=0;const rows=[];
 async function visit(dir,relative){
  check();if(++nodes>20000)throw fail('Working directory inspection limit exceeded');
  const s=await fs.lstat(dir,{bigint:true});
  if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(dir)!==dir)throw fail('Linked working directory');
  rows.push([relative,identity(s)]);
  const names=(await fs.readdir(dir)).filter(name=>relative||name!=='.git');check();
  if(names.length>20000-nodes)throw fail('Working directory inspection limit exceeded');
  for(const name of names.sort()){
   if(['.gitattributes','.gitmodules','.git'].includes(name.toLowerCase()))throw fail('Attributes, nested repositories or submodules unsupported');
   const file=path.join(dir,name),stat=await fs.lstat(file,{bigint:true});
   if(stat.isDirectory()&&!stat.isSymbolicLink())await visit(file,relative+'/'+name);
   else if(++nodes>20000||!plain(stat))throw fail('Linked or special working file');
  }
 }await visit(root,'');return rows;
}
function validateConfig(bytes){
 for(const row of decode(bytes).split('\0').filter(Boolean)){
  const i=row.indexOf('\n'),key=(i<0?row:row.slice(0,i)).toLowerCase(),value=(i<0?'':row.slice(i+1)).toLowerCase();
  if(/^(filter|hook|include|submodule|gpg)\./.test(key)||key.startsWith('includeif.')||key.startsWith('extensions.')&&key!=='extensions.objectformat'||['core.worktree','core.hookspath','core.attributesfile','core.sshcommand','core.gitproxy','core.sharedrepository','core.sparsecheckout','core.sparsecheckoutcone','core.splitindex','core.untrackedcache','index.sparse','commit.gpgsign','tag.gpgsign','user.signingkey','commit.template','i18n.commitencoding'].includes(key)||/^remote\..*\.(promisor|partialclonefilter)$/.test(key))throw fail('Unsupported repository configuration: '+key);
  if(['core.autocrlf','core.safecrlf','core.fsmonitor'].includes(key)&&!['false','no','0'].includes(value))throw fail('Content conversions unsupported');
 }
}
async function capture(root){
 check();if(await fs.realpath(root)!==root)throw fail('Canonical root required');
 const rootStat=await fs.lstat(root,{bigint:true});if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw fail('Directory root required');
 const directory=path.join(root,'.git');
 const [meta,work]=await settledReads([()=>metadata(directory),()=>workPolicy(root)]);
 for(const file of [path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'),'git','attributes'),path.join(os.homedir(),'.gitattributes'),...(process.platform==='win32'?[]:['/etc/gitattributes','/usr/local/etc/gitattributes'])])if(await exists(file))throw fail('Global attributes unsupported');
 const localConfig=await readPlain(path.join(directory,'config'),CONFIG);
 const config=await git(root,['--git-dir='+directory,'--work-tree='+root,'config','--no-includes','--null','--list'],CONFIG);validateConfig(config);
 const facts=decode(await git(root,['rev-parse','--absolute-git-dir','--git-common-dir','--show-toplevel','--is-bare-repository','--show-object-format','--verify','HEAD^{commit}'],16384)).split('\n');
 if(facts.length!==7||facts[6]!==''||facts.slice(0,3).some(s=>!s||/[\r\0]/.test(s))||path.resolve(root,facts[0])!==directory||path.resolve(root,facts[1])!==directory||path.resolve(facts[2])!==root||facts[3]!=='false')throw fail('Born embedded non-bare Git repository required');
 const objectFormat=facts[4],head=facts[5];
 if(!['sha1','sha256'].includes(objectFormat)||!(objectFormat==='sha1'?/^[a-f0-9]{40}$/:/^[a-f0-9]{64}$/).test(head))throw fail('Invalid fixed HEAD');
 const headFile=await readPlain(path.join(directory,'HEAD'),4096),text=decode(headFile.bytes);
 if(!/^ref: refs\/heads\/[^\r\n]+\n?$/.test(text))throw fail('Born symbolic HEAD required');
 const ref=text.replace(/\n$/,'').slice(5);await git(root,['check-ref-format',ref],4096);
 const index=await readPlain(path.join(directory,'index'),INDEX),parsed=parseGitIndex(index.bytes,{objectFormat});
 if(parsed.extensions.some(e=>!['TREE','EOIE','IEOT'].includes(e.signature)))throw fail('Unsupported Index extension');
 const folded=new Set();for(const e of parsed.entries){
  const key=e.path.toLowerCase();if(folded.has(key)||e.path.split('/').some(p=>['.gitattributes','.gitmodules'].includes(p.toLowerCase())))throw fail('Ambiguous Index paths or tracked attributes unsupported');folded.add(key);
 }
 // Close each capture with a metadata barrier as well: changes late in the
 // second capture must not escape merely because HEAD was read earlier.
 if(!equal(meta,await metadata(directory))||!equal(identity(rootStat),identity(await fs.lstat(root,{bigint:true})))||await fs.realpath(root)!==root)throw fail('Stale repository metadata during capture');
 return {bytes:index.bytes,entries:parsed.entries,head,ref,objectFormat,fingerprint:{root:identity(rootStat),meta,work,config:hash(config),localConfig:[localConfig.version,hash(localConfig.bytes)],headFile:[headFile.version,hash(headFile.bytes)],index:[index.version,hash(index.bytes)],head,ref,objectFormat}};
}

async function readFixedHead(root,state){
 // All capture policy guards precede fixed reads; never resolve moving HEAD.
 // Cached attributes avoid opening working content.
 for(let i=0;i<state.entries.length;i+=128){
  if((await git(root,['check-attr','--cached','--all','-z','--',...state.entries.slice(i,i+128).map(e=>e.path)],CONFIG)).length)throw fail('Git attributes unsupported');
 }
 return git(root,['cat-file','commit',state.head],PARENT);
}
async function verifyFixedBlobs(root,state){
 for(const oid of new Set(state.entries.map(e=>e.oid))){check();if(decode(await git(root,['cat-file','-t',oid],128))!=='blob\n')throw fail('Index entry is not an existing blob');}
}
async function rebuild(root,state,{author,committer,message}){
 const body=await readFixedHead(root,state);
 const plan=createVerifiedIndexCommitPlan(state.bytes,body,{objectFormat:state.objectFormat,parent:state.head,author,committer,message,signal:currentOperationBudget().signal});
 await verifyFixedBlobs(root,state);
 return plan;
}
function safeSummary(state,plan,{author,committer,message}){
 return Object.freeze({head:state.head,ref:state.ref,objectFormat:state.objectFormat,indexDigest:plan.indexDigest,tree:plan.tree,commit:Object.freeze({oid:plan.commit.oid}),author,committer,message});
}
async function authorize(callback){
 check();const {signal}=currentOperationBudget();
 // A stalled external authorization callback cannot defeat the shared deadline.
 let abort;const canceled=new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});});
 try{await Promise.race([Promise.resolve().then(callback),canceled]);check();}
 finally{signal.removeEventListener('abort',abort);}
}
/** Single-use, read-only revalidation; not an execution/publication API.
 * The retained plan is reserved for future internal composition and discarded here.
 * Work content is neither read nor pinned: the existing fingerprint records directory
 * identities only, while workPolicy still rejects special files/attributes/nested Git.
 * No global filesystem atomicity is promised by these observation barriers.
 */
export async function consumeCommitPreview(repo,options={}){
 // Burn an own-data snapshot BEFORE validating any other metadata or callbacks,
 // including malformed options and a wrong repository. Never invoke a getter.
 const descriptor=options&&Object.getOwnPropertyDescriptor(options,'snapshot');
 const snapshot=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 const saved=previews.get(snapshot);previews.delete(snapshot);
 const r=record(repo,['type','root'],'repository'),o=record(options,['snapshot','signal','assertAuthorized'],'options');
 if(!saved)throw fail('A single-use server-issued commit preview is required');
 if(r.type!=='git'||typeof r.root!=='string'||!path.isAbsolute(r.root)||path.resolve(r.root)!==r.root||r.root!==saved.root)throw fail('Same canonical Git root required');
 if(typeof o.assertAuthorized!=='function')throw fail('Authorization callback required');
 return withOperationBudget({signal:o.signal},async()=>{
  await authorize(o.assertAuthorized);
  const first=await capture(r.root);
  if(!equal(saved.fingerprint,first.fingerprint))throw fail('Stale repository changed since commit preview');
  const plan=await rebuild(r.root,first,snapshot);
  if(plan.id!==saved.plan.id)throw fail('Stale rebuilt commit plan');
  await authorize(o.assertAuthorized);
  // Must follow the LAST external callback, which may itself mutate the repository.
  const final=await capture(r.root);
  if(!equal(saved.fingerprint,final.fingerprint))throw fail('Stale repository changed during commit preview consumption');
  check();return safeSummary(final,plan,snapshot);
 });
}

/** Internal commit transaction. CALLER MUST hold the shared repository writer mutex
 * across prepare/apply (at least the entire apply). No Host/UI integration.
 * Observation barriers are not hostile-external-process isolation: no index lock is
 * held, so index edits between the final check and ref CAS can only be diagnosed
 * afterwards. No work content reads/writes, rollback, or crash-durability promise.
 * Requires a loose born branch and existing HEAD/branch reflogs; no log creation.
 * Publisher authorization is raw while its owned temporary file exists; full
 * original+verified-created-object barriers follow publication and precede CAS.
 */
export async function applyCommitPreview(repo,options={}){
 const descriptor=options&&Object.getOwnPropertyDescriptor(options,'snapshot');
 const snapshot=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 const saved=previews.get(snapshot);previews.delete(snapshot);
 return executeSnapshot(repo,options,saved,'commit');
}

/** Internal amend transaction; the same caller-held writer mutex is required.
 * Only this entrypoint can consume amend capabilities. No public mode flag. */
export async function applyAmendPreview(repo,options={}){
 const descriptor=options&&Object.getOwnPropertyDescriptor(options,'snapshot');
 const snapshot=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 const saved=amendPreviews.get(snapshot);amendPreviews.delete(snapshot);
 return executeSnapshot(repo,options,saved,'amend');
}

async function executeSnapshot(repo,options,saved,kind){
 const r=record(repo,['type','root'],'repository'),o=record(options,['snapshot','signal','assertAuthorized','onStart'],'options');
 const snapshot=kind==='amend'?saved?.plan:o.snapshot;
 if(!saved)throw fail('A single-use server-issued '+kind+' preview is required');
 if(r.type!=='git'||typeof r.root!=='string'||!path.isAbsolute(r.root)||path.resolve(r.root)!==r.root||r.root!==saved.root)throw fail('Same canonical Git root required');
 if(typeof o.assertAuthorized!=='function'||typeof o.onStart!=='function')throw fail('Authorization and synchronous start callbacks required');
 let started=false;
 try{return await withOperationBudget({signal:o.signal,timeoutMs:15000},async()=>{
  const original=saved.fingerprint,plan=saved.plan,directory=path.join(r.root,'.git');
  const rawAuth=()=>authorize(o.assertAuthorized);
  const start=()=>{
   check();if(started)return;started=true;
   const value=o.onStart();
   if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});throw fail('onStart must be synchronous');}
   check();
  };
  const exact=state=>{if(!equal(original,state.fingerprint))throw fail('Stale repository changed since commit preview');};
  await rawAuth();const first=await capture(r.root);exact(first);
  const rebuilt=kind==='amend'
   ?createAmendPlan(first.bytes,await readFixedHead(r.root,first),{head:first.head,objectFormat:first.objectFormat,committer:snapshot.committer,message:snapshot.message,signal:currentOperationBudget().signal})
   :await rebuild(r.root,first,snapshot);
  if(kind==='amend')await verifyFixedBlobs(r.root,first);
  if(rebuilt.id!==plan.id)throw fail('Stale rebuilt '+kind+' plan');
  const ref=original.ref,mutable=new Set([ref,'logs/HEAD','logs/'+ref]);
  const baseline=new Map(original.meta),logs=new Map();
  for(const name of mutable){
   if(!baseline.has(name)||baseline.get(name).length!==7)throw fail('Existing loose branch and reflogs required');
   const file=await readPlain(path.join(directory,...name.split('/')),1024*1024);
   if(!equal(file.version,baseline.get(name)))throw fail('Stale branch or reflog');
   if(name===ref){if(decode(file.bytes)!==original.head+'\n')throw fail('Exact loose branch required');}
   else logs.set(name,file.bytes);
  }
  await rawAuth();exact(await capture(r.root));check();
  const published=await publishCommitObjects({gitDirectory:directory,objectFormat:original.objectFormat,trees:plan.trees,commit:plan.commit,signal:currentOperationBudget().signal,assertAuthorized:rawAuth,onStart:start});
  // Only the publisher's actual newly-created list grants additions. Existing
  // object rows must remain byte-version-identical, even when candidates match.
  const owned=new Map(),allowed=new Set();
  for(const {type,oid} of published.created){
   const object=type==='commit'?plan.commit:plan.trees.find(t=>t.oid===oid);
   if(!object||object.oid!==oid)throw fail('Unexpected published object');
   const name='objects/'+oid.slice(0,2)+'/'+oid.slice(2),fanout='objects/'+oid.slice(0,2);
   if(baseline.has(name))throw fail('Publisher changed a preexisting object');
   allowed.add(name);if(!baseline.has(fanout))allowed.add(fanout);
   const stored=await readPlain(path.join(directory,...name.split('/')),object.body.length+1024*1024);
   const inflated=inflateSync(stored.bytes,{maxOutputLength:object.body.length+128,info:true});check();
   const raw=inflated.buffer,expected=Buffer.concat([Buffer.from(type+' '+object.body.length+'\0'),object.body]);
   if(inflated.engine.bytesWritten!==stored.bytes.length||!raw.equals(expected)||createHash(original.objectFormat).update(raw).digest('hex')!==oid)throw fail('Stored object differs from saved plan');
   owned.set(name,stored.version);
  }
  let ownedRows;
  const barrier=async(post=false)=>{
   const current=await capture(r.root),fp=current.fingerprint,rows=new Map(fp.meta);
   for(const [name,row] of baseline){
    if(!rows.has(name)||(!post||!mutable.has(name))&&!equal(row,rows.get(name)))throw fail('Stale original metadata: '+name);
   }
   for(const [name,row] of rows)if(!baseline.has(name)){
    if(!allowed.has(name)||owned.has(name)&&!equal(owned.get(name),row))throw fail('Foreign or changed object metadata: '+name);
   }
   const additions=fp.meta.filter(([name])=>!baseline.has(name));
   if(additions.length!==allowed.size||ownedRows&&!equal(ownedRows,additions))throw fail('Owned object metadata changed');
   if(!ownedRows)ownedRows=additions;
   const normalized={...fp,meta:original.meta,head:post?original.head:fp.head};
   if(!equal(normalized,original)||post&&fp.head!==plan.commit.oid)throw fail('Stale repository fingerprint');
   if(!current.bytes.equals(first.bytes))throw fail('Index bytes changed');
   return current;
  };
  await barrier();
  let refStarted=false;
  await compareAndSwapBranch(r,{ref,expectedOid:original.head,newOid:plan.commit.oid,objectFormat:original.objectFormat,signal:currentOperationBudget().signal,
   assertAuthorized:async()=>{await rawAuth();if(!refStarted)await barrier();},
   onStart:()=>{check();refStarted=true;start();check();}});
  await barrier(true);
  for(const [name,before] of logs){
   const after=(await readPlain(path.join(directory,...name.split('/')),1024*1024)).bytes;
   const tail=after.subarray(before.length);
   if(!after.subarray(0,before.length).equals(before)||!decode(tail).startsWith(original.head+' '+plan.commit.oid+' ')||decode(tail).split('\n').length!==2)throw fail('Unexpected reflog change');
  }
  if(decode((await readPlain(path.join(directory,...ref.split('/')),4096)).bytes)!==plan.commit.oid+'\n')throw fail('Unexpected branch tip');
  check();return Object.freeze({head:plan.commit.oid,ref,tree:plan.tree,indexDigest:plan.indexDigest});
 });}catch(cause){
  if(!started)throw cause;
  throw Object.assign(new Error((kind==='amend'?'Amend':'Commit')+' started; outcome unknown. Inspect repository; never roll back appended objects or retry automatically.',{cause}),{code:'vcs/'+kind+'-outcome-unknown',appendOnly:true,outcomeUnknown:true});
 }
}

/** Read-only, conservative two-capture preview; private retained plan.
 * Repeated observations are stale barriers, not global filesystem atomicity.
 * Only regular stage-zero Index entries; no hooks/signing/attributes/conversions,
 * linked/shared/alternate/shallow repositories, active operations or locks.
 */
export async function prepareCommitPreview(repo,options={}){
 // Strict metadata snapshots and validation happen synchronously before the first await.
 const r=record(repo,['type','root'],'repository'),o=record(options,['author','committer','message','signal'],'options');
 if(r.type!=='git'||typeof r.root!=='string'||!path.isAbsolute(r.root)||path.resolve(r.root)!==r.root)throw fail('Absolute canonical Git root required');
 const author=record(o.author,['name','email','timestamp','timezone'],'author'),committer=record(o.committer,['name','email','timestamp','timezone'],'committer');
 if(typeof o.message!=='string'||Buffer.byteLength(o.message)>65536||!o.message.trim()||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(o.message.replace(/[\n\t]/g,'')))throw fail('Bounded plaintext commit message required');
 const message=o.message;
 // Reuse the pure encoder to reject all invalid identities before repository I/O.
 encodeGitCommit({tree:'1'.repeat(40),parents:[],author,committer,message});
 Object.freeze(author);Object.freeze(committer);
 return withOperationBudget({signal:o.signal},async()=>{
  const first=await capture(r.root);check();
  const plan=await rebuild(r.root,first,{author,committer,message});
  const second=await capture(r.root);
  if(!equal(first.fingerprint,second.fingerprint))throw fail('Stale repository changed during commit preview');
  check();const summary=safeSummary(first,plan,{author,committer,message});
  previews.set(summary,{root:r.root,fingerprint:first.fingerprint,plan});return summary;
 });
}
/** Read-only amend preview; its separate capability is consumed only by applyAmendPreview. */
export async function prepareAmendPreview(repo,options={}){
 // Snapshot strict own-data metadata before the first await, just like commit preview.
 const r=record(repo,['type','root'],'repository'),o=record(options,['committer','message','signal'],'options');
 if(r.type!=='git'||typeof r.root!=='string'||!path.isAbsolute(r.root)||path.resolve(r.root)!==r.root)throw fail('Absolute canonical Git root required');
 const committer=record(o.committer,['name','email','timestamp','timezone'],'committer');
 if(typeof o.message!=='string'||Buffer.byteLength(o.message)>65536||!o.message.trim()||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(o.message.replace(/[\n\t]/g,'')))throw fail('Bounded plaintext commit message required');
 const message=o.message;
 encodeGitCommit({tree:'1'.repeat(40),parents:[],author:committer,committer,message});
 Object.freeze(committer);
 return withOperationBudget({signal:o.signal},async()=>{
  const first=await capture(r.root);check();
  const body=await readFixedHead(r.root,first);
  const plan=createAmendPlan(first.bytes,body,{head:first.head,objectFormat:first.objectFormat,committer,message,signal:currentOperationBudget().signal});
  await verifyFixedBlobs(r.root,first);
  const second=await capture(r.root);
  if(!equal(first.fingerprint,second.fingerprint))throw fail('Stale repository changed during amend preview');
  check();const summary=Object.freeze({action:'amend',head:first.head,ref:first.ref,objectFormat:first.objectFormat,indexDigest:plan.indexDigest,previousTree:plan.previousTree,parents:plan.parents,author:plan.author,committer:plan.committer,message:plan.message,tree:plan.tree,commit:Object.freeze({oid:plan.commit.oid})});
  amendPreviews.set(summary,{root:r.root,fingerprint:first.fingerprint,plan});return summary;
 });
}
