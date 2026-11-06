// Internal read-only fixed-HEAD metadata projection; not an amend capability.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {git} from './local-command.mjs';
import {withOperationBudget,currentOperationBudget} from './src/operation-budget.mjs';
import {readVerifiedCommitMetadata} from './src/verified-commit-metadata.mjs';
const BODY=2*1024*1024,CONFIG=256*1024;
const hash=b=>createHash('sha256').update(b).digest('hex');
const decode=b=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
const check=()=>currentOperationBudget().throwIfExpired();
const fail=message=>Object.assign(new Error(message),{code:'vcs/latest-commit'});
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
const forbidden=new Set(['commondir','gitdir','shallow','config.worktree','MERGE_HEAD','MERGE_MSG','CHERRY_PICK_HEAD','REVERT_HEAD','REBASE_HEAD','BISECT_LOG','BISECT_START','rebase-merge','rebase-apply','sequencer','worktrees','info/sparse-checkout','info/attributes','objects/info/alternates','objects/info/http-alternates'].map(s=>s.toLowerCase()));
async function metadata(directory){
 const rows=[];let nodes=0;
 async function visit(file,relative){
  check();if(++nodes>20000)throw fail('Metadata inspection limit exceeded');
  const key=relative.toLowerCase();
  if(forbidden.has(key)||key.endsWith('.lock')||key.endsWith('.promisor')||key.startsWith('sharedindex.')||key.startsWith('hooks/')&&!key.endsWith('.sample'))throw fail('Unsupported repository metadata: '+relative);
  const s=await fs.lstat(file,{bigint:true});
  if(s.isSymbolicLink()||(!s.isDirectory()&&!plain(s))||await fs.realpath(file)!==file)throw fail('Linked or special repository metadata');
  rows.push([relative,version(s)]);
  if(s.isDirectory()){
   const names=await fs.readdir(file);check();
   if(names.length>20000-nodes)throw fail('Metadata inspection limit exceeded');
   for(const name of names.sort())await visit(path.join(file,name),relative?relative+'/'+name:name);
  }
 }
 await visit(directory,'');return rows;
}
// Deliberately narrow: no include, executable, external-path, shared or extension settings.
const allowedConfig=new Set(['core.repositoryformatversion','core.filemode','core.symlinks','core.bare','core.logallrefupdates','core.ignorecase','core.precomposeunicode','core.autocrlf','core.safecrlf','core.fsmonitor','extensions.objectformat','user.name','user.email']);
function validateConfig(bytes){
 for(const row of decode(bytes).split('\0').filter(Boolean)){
  const i=row.indexOf('\n'),key=(i<0?row:row.slice(0,i)).toLowerCase(),value=(i<0?'':row.slice(i+1)).toLowerCase();
  if(!allowedConfig.has(key))throw fail('Unsupported repository configuration: '+key);
  if(['core.autocrlf','core.safecrlf','core.fsmonitor','core.bare'].includes(key)&&!['false','no','0'].includes(value))throw fail('Unsupported repository configuration value: '+key);
 }
}
async function capture(root){
 check();if(await fs.realpath(root)!==root)throw fail('Canonical root required');
 const rootStat=await fs.lstat(root,{bigint:true});
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink())throw fail('Directory root required');
 const directory=path.join(root,'.git'),gitStat=await fs.lstat(directory,{bigint:true});
 if(!gitStat.isDirectory()||gitStat.isSymbolicLink())throw fail('Embedded Git directory required');
 const meta=await metadata(directory),localConfig=await readPlain(path.join(directory,'config'),CONFIG);
 // Must be the first Git invocation: never follow an include before policy validation.
 const config=await git(root,['--git-dir='+directory,'--work-tree='+root,'config','--no-includes','--null','--list'],CONFIG);validateConfig(config);
 const facts=decode(await git(root,['rev-parse','--absolute-git-dir','--git-common-dir','--show-toplevel','--is-bare-repository','--show-object-format','--verify','HEAD^{commit}'],16384)).split('\n');
 if(facts.length!==7||facts[6]!==''||facts.slice(0,3).some(s=>!s||/[\r\0]/.test(s))||path.resolve(root,facts[0])!==directory||path.resolve(root,facts[1])!==directory||path.resolve(facts[2])!==root||facts[3]!=='false')throw fail('Born embedded non-bare Git repository required');
 const objectFormat=facts[4],head=facts[5];
 if(!['sha1','sha256'].includes(objectFormat)||!(objectFormat==='sha1'?/^[a-f0-9]{40}$/:/^[a-f0-9]{64}$/).test(head))throw fail('Invalid fixed HEAD');
 const headFile=await readPlain(path.join(directory,'HEAD'),4096),text=decode(headFile.bytes);
 if(!/^ref: refs\/heads\/[^\r\n]+\n?$/.test(text))throw fail('Born symbolic HEAD required');
 const ref=text.replace(/\n$/,'').slice(5);await git(root,['check-ref-format',ref],4096);
 const refPath=path.join(directory,...ref.split('/'));
 // Capture raw loose ref, or the raw packed table if the branch is packed.
 let rawRef;
 try{rawRef=await readPlain(refPath,4096);if(decode(rawRef.bytes)!==head+'\n'&&decode(rawRef.bytes)!==head)throw fail('Stale or symbolic branch ref');}
 catch(error){if(error.code!=='ENOENT')throw error;rawRef=await readPlain(path.join(directory,'packed-refs'),BODY);
  if(!decode(rawRef.bytes).split('\n').includes(head+' '+ref))throw fail('Stale packed branch ref');}
 // Closing barrier catches metadata replacement during the LAST capture too.
 if(!equal(meta,await metadata(directory))||!equal(identity(rootStat),identity(await fs.lstat(root,{bigint:true})))||await fs.realpath(root)!==root)throw fail('Stale repository metadata during capture');
 return {head,ref,objectFormat,fingerprint:{root:identity(rootStat),meta,config:hash(config),localConfig:[localConfig.version,hash(localConfig.bytes)],headFile:[headFile.version,hash(headFile.bytes)],rawRef:[rawRef.version,hash(rawRef.bytes)],head,ref,objectFormat}};
}
/** No index/work-content reads, hooks or writes. Observation barriers are not
 * hostile-external-process atomicity. Active hooks are conservatively refused. */
export async function readLatestCommit(repo,options={}){
 // Capture caller-owned records synchronously, before the first await.
 const r=record(repo,['type','root'],'repository'),o=record(options,['signal'],'options');
 if(r.type!=='git'||typeof r.root!=='string'||!path.isAbsolute(r.root)||path.resolve(r.root)!==r.root)throw fail('Canonical Git root required');
 if(o.signal!==undefined){try{Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,o.signal,[]);}catch{throw fail('Native AbortSignal required');}}
 return withOperationBudget({signal:o.signal,timeoutMs:15000},async()=>{
  const first=await capture(r.root);
  const body=await git(r.root,['cat-file','commit',first.head],BODY);
  const value=readVerifiedCommitMetadata(body,{oid:first.head,objectFormat:first.objectFormat,signal:currentOperationBudget().signal});
  const last=await capture(r.root);
  if(!equal(first.fingerprint,last.fingerprint))throw fail('Stale repository changed during latest commit read');
  check();return Object.freeze({head:first.head,ref:first.ref,objectFormat:first.objectFormat,tree:value.tree,parents:value.parents,author:value.author,committer:value.committer,message:value.message,messageBytes:value.messageBytes});
 });
}
