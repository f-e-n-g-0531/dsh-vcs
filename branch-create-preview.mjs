// Preview is read-only; its exact frozen summary is a private single-use capability.
// Supports canonical embedded, born symbolic-HEAD repositories only; packed refs
// (even unrelated) and reftable are conservatively refused. This is NOT all Git.
// Barriers detect observed changes, not global atomicity or hostile path swaps.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {readLatestCommit} from './latest-commit.mjs';
import {git as safeGit} from './local-command.mjs';
import {createLocalBranch} from './git-branch-create.mjs';
import {withOperationBudget,currentOperationBudget} from './src/operation-budget.mjs';
const prepared=new WeakMap();

const fail=message=>Object.assign(new Error(message),{code:'vcs/branch-create-preview'});
const check=()=>currentOperationBudget().throwIfExpired();
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const identity=s=>[s.dev,s.ino,s.birthtimeNs].map(String);
const version=s=>[...identity(s),s.size,s.mtimeNs,s.ctimeNs,s.mode].map(String);
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
function validateName(name){
 if(typeof name!=='string'||!name||Buffer.from(name,'utf8').toString('utf8')!==name||Buffer.byteLength(name,'utf8')>1000||
  name==='@'||name.toUpperCase()==='HEAD'||name.startsWith('-')||name.startsWith('refs/')||/[\x00-\x20\x7f~^:?*\[\\<>"|\p{Cc}\p{Cf}]/u.test(name)||name.includes('..')||name.includes('@{')||
  name.split('/').some(p=>!p||Buffer.byteLength(p,'utf8')>255||p.startsWith('.')||/[. ]$/.test(p)||p.toLowerCase().endsWith('.lock')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
  throw fail('Safe portable short branch name required');
}
async function stat(file){check();try{return await fs.lstat(file,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function directory(file){
 const s=await stat(file);if(!s||!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(file)!==file)throw fail('Canonical metadata directory required');return s;
}
async function raw(file,max){
 check();const before=await stat(file);
 if(!before||!plain(before)||before.size>BigInt(max))throw fail('Bounded single-link metadata file required');
 const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const opened=await handle.stat({bigint:true});if(!plain(opened)||!equal(version(before),version(opened)))throw fail('Stale metadata opening');
  const bytes=Buffer.alloc(max+1);let n=0;
  while(n<bytes.length){check();const r=await handle.read(bytes,n,bytes.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}
  const after=await handle.stat({bigint:true}),now=await stat(file);
  if(n>max||!now||!plain(now)||!equal(version(opened),version(after))||!equal(version(after),version(now))||BigInt(n)!==after.size)throw fail('Stale metadata reading');
  return [version(after),bytes.subarray(0,n).toString('hex')];
 }finally{await handle.close();}
}
// Match the full reader's metadata policy without reading object/index/hook bodies.
const forbidden=new Set(['commondir','gitdir','shallow','config.worktree','MERGE_HEAD','MERGE_MSG','CHERRY_PICK_HEAD','REVERT_HEAD','REBASE_HEAD','BISECT_LOG','BISECT_START','rebase-merge','rebase-apply','sequencer','worktrees','info/sparse-checkout','info/attributes','objects/info/alternates','objects/info/http-alternates'].map(s=>s.toLowerCase()));
const effectiveConfig=root=>safeGit(root,['--git-dir='+path.join(root,'.git'),'--work-tree='+root,'config','--no-includes','--null','--list'],256*1024);
async function capture(root,name,created=false){
 check();const rootStat=await directory(root),git=path.join(root,'.git'),gitStat=await directory(git);
 const entries=await fs.readdir(git);
 if(entries.some(n=>['packed-refs','reftable'].includes(n.toLowerCase())))throw fail('Unsupported packed refs or reftable');
 for(const expected of ['HEAD','config','refs','logs'])if(entries.some(n=>n.toLowerCase()===expected.toLowerCase()&&n!==expected))throw fail('Noncanonical metadata spelling');
 const head=await raw(path.join(git,'HEAD'),4096),config=await raw(path.join(git,'config'),256*1024);
 const rows=[];let nodes=0;
 async function visit(file,rel){
  check();if(++nodes>20000)throw fail('Namespace metadata limit exceeded');
  const s=await stat(file);if(!s){rows.push([rel,null]);return;}
  if(s.isSymbolicLink()||(!s.isDirectory()&&!plain(s))||await fs.realpath(file)!==file)throw fail('Linked or special namespace metadata');
  const key=rel.toLowerCase();
  if(forbidden.has(key)||key.endsWith('.lock')||key.endsWith('.promisor')||key.startsWith('sharedindex.')||key.startsWith('hooks/')&&!key.endsWith('.sample'))throw fail('Unsupported repository metadata: '+rel);
  rows.push([rel,version(s)]);
  if(s.isDirectory()){
   const names=await fs.readdir(file);if(names.length>20000-nodes)throw fail('Metadata inspection limit exceeded');
   for(const entry of names.sort())await visit(path.join(file,entry),rel?rel+'/'+entry:entry);
  }
 }
 await visit(git,'');
 for(const base of ['refs','logs'])if(!entries.includes(base))rows.push([base,null]);
 // Inspect every prefix, including the reflog namespace. An existing final
 // directory is a collision too. Case-fold aliases fail closed on every OS.
 for(const parts of created?[]:[['refs','heads',...name.split('/')],['logs','refs','heads',...name.split('/')]]){
  let parent=git;
  for(let i=0;i<parts.length;i++){
   check();const names=await fs.readdir(parent),part=parts[i];
   const matches=names.filter(n=>n.toLowerCase()===part.toLowerCase());
   if(!matches.length)break;
   if(matches.length!==1||matches[0]!==part)throw fail('Portable target namespace collision');
   const file=path.join(parent,part),s=await stat(file);
   if(i===parts.length-1||!s||!s.isDirectory()||s.isSymbolicLink())throw fail('Target branch or prefix/reflog collision');
   if(await fs.realpath(file)!==file)throw fail('Noncanonical target prefix');parent=file;
  }
 }
 check();return {root:identity(rootStat),git:identity(gitStat),head,config,rows};
}
/** Prepare only from authenticated CURRENT HEAD, never a caller-provided OID.
 * No index/worktree contents are read. Preview makes no writes or temporary hooks.
 * The exact returned object binds apply authority privately; copies carry none.
 * Raw HEAD/config and namespace versions span BOTH readLatestCommit calls;
 * effective configuration is pinned before full-reader policy validation.
 * Concurrent mutation followed by restoration can escape observation barriers.
 */
export async function prepareBranchCreate(repo,options={}){
 const r=record(repo,['type','root'],'repository'),o=record(options,['name','signal'],'options');
 if(r.type!=='git'||typeof r.root!=='string'||!path.isAbsolute(r.root)||path.resolve(r.root)!==r.root)throw fail('Canonical Git root required');
 validateName(o.name);
 if(o.signal!==undefined){try{Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,o.signal,[]);}catch{throw fail('Native AbortSignal required');}}
 const name=o.name,ref='refs/heads/'+name;
 return withOperationBudget({signal:o.signal,timeoutMs:15000},async()=>{
  const before=await capture(r.root,name),configBaseline=await effectiveConfig(r.root);
  // No caller callbacks between this baseline and strict full-reader validation.
  const first=await readLatestCommit({type:r.type,root:r.root},{signal:o.signal});
  const last=await readLatestCommit({type:r.type,root:r.root},{signal:o.signal});
  const after=await capture(r.root,name); // Includes absence after the second read.
  if(!(await effectiveConfig(r.root)).equals(configBaseline)||first.head!==last.head||first.ref!==last.ref||first.objectFormat!==last.objectFormat||!equal(before,after))throw fail('Stale repository changed during branch preview');
  check();const summary=Object.freeze({action:'branch-create',name,ref,target:Object.freeze({oid:first.head}),head:first.head,currentRef:first.ref,objectFormat:first.objectFormat});
  prepared.set(summary,{root:r.root,name,before,configBaseline,head:first.head,currentRef:first.ref,objectFormat:first.objectFormat,ref});return summary;
 });
}

function createdCapture(before,after,ref){
 for(const key of ['root','git','head','config'])if(!equal(before[key],after[key]))throw fail('Original repository metadata changed');
 const targets=new Set([ref,'logs/'+ref]),ancestors=new Set(['']);
 for(const target of targets){const parts=target.split('/');for(let i=1;i<parts.length;i++)ancestors.add(parts.slice(0,i).join('/'));}
 const old=new Map(before.rows),now=new Map(after.rows);
 const isDir=v=>v!=null&&(Number(v[6])&0o170000)===0o040000;
 for(const [name,v] of old){
  const n=now.get(name);
  if(equal(v,n))continue;
  // Only ancestor mkdir timestamps/size may change; preserve identity and mode.
  // Never replace the original baseline with a fresh one.
  if(ancestors.has(name)&&isDir(n)&&(v===null||isDir(v)&&equal(v.slice(0,3),n.slice(0,3))&&v[6]===n[6]))continue;
  throw fail('Existing namespace row changed: '+name);
 }
 for(const [name,v] of now)if(!old.has(name)||old.get(name)===null){
  if(targets.has(name)&&v!==null&&!isDir(v))continue;
  if(ancestors.has(name)&&isDir(v))continue;
  if(v===null&&old.get(name)===null)continue;
  throw fail('Unexpected namespace addition: '+name);
 }
 if(!now.has(ref)||now.get(ref)===null)throw fail('Created target missing');
}

/** Apply an exact prepare result once. Caller MUST hold its repository writer
 * mutex throughout. Reads, callbacks and primitive share one inherited <=15s
 * budget, not a globally atomic filesystem snapshot. No name/OID overrides.
 * Authorization may be async; trusted onStart MUST be synchronous.
 * Returns {name,ref,commit,currentRef}, with commit fixed at preview HEAD.
 * Every post-start failure is outcome-unknown: never retry or roll back a ref.
 */
export async function applyBranchCreate(repo,options={}){
 // Burn before any validation, callback or await. Never invoke token getters.
 const descriptor=options&&typeof options==='object'?Object.getOwnPropertyDescriptor(options,'snapshot'):undefined;
 const snapshot=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 const bound=prepared.get(snapshot);prepared.delete(snapshot);
 const r=record(repo,['type','root'],'repository'),o=record(options,['snapshot','signal','assertAuthorized','onStart'],'options');
 if(!bound||r.type!=='git'||r.root!==bound.root)throw fail('Missing, consumed or cross-repository branch snapshot');
 if(typeof o.assertAuthorized!=='function'||typeof o.onStart!=='function')throw fail('Authorization and synchronous start callbacks required');
 if(o.signal!==undefined){try{Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,o.signal,[]);}catch{throw fail('Native AbortSignal required');}}
 const fixedRepo={type:'git',root:bound.root};let started=false;
 const facts=async()=>{
  if(!(await effectiveConfig(bound.root)).equals(bound.configBaseline))throw fail('Effective Git configuration changed');
  const direct=await raw(path.join(bound.root,'.git',...bound.currentRef.split('/')),4096);
  // Full, direct OID bytes, never Git DWIM or a newly resolved symbolic ref.
  if(![bound.head,bound.head+'\n'].some(text=>direct[1]===Buffer.from(text).toString('hex')))throw fail('Original HEAD facts changed');
 };
 const fresh=async()=>{
  if(!equal(bound.before,await capture(bound.root,bound.name)))throw fail('Stale branch snapshot');
  await facts();
  if(!equal(bound.before,await capture(bound.root,bound.name)))throw fail('Stale branch snapshot');
  check();
 };
 const post=async()=>{
  createdCapture(bound.before,await capture(bound.root,bound.name,true),bound.ref);
  await facts();
  const target=path.join(bound.root,'.git',...bound.ref.split('/'));
  const direct=await raw(target,4096);
  if(direct[1]!==Buffer.from(bound.head+'\n').toString('hex'))throw fail('Created target is not the fixed direct commit');
  const final=await capture(bound.root,bound.name,true);
  createdCapture(bound.before,final,bound.ref);
  if(!equal(new Map(final.rows).get(bound.ref),direct[0]))throw fail('Created target changed after raw verification');
  check();
 };
 try{return await withOperationBudget({signal:o.signal,timeoutMs:15000},async()=>{
  // Authenticate policy and target bytes once, retaining PREPARE's metadata/config.
  await fresh();
  const latest=await readLatestCommit(fixedRepo,{signal:o.signal});
  if(latest.head!==bound.head||latest.ref!==bound.currentRef||latest.objectFormat!==bound.objectFormat)throw fail('Original HEAD facts changed');
  await fresh();
  await createLocalBranch(fixedRepo,{ref:bound.ref,commit:bound.head,objectFormat:bound.objectFormat,signal:o.signal,
   assertAuthorized:async()=>{check();await o.assertAuthorized();check();if(!started)await fresh();},
   onStart:()=>{started=true;return o.onStart();}});
  await post();
  await o.assertAuthorized();check();await post();
  return {name:bound.name,ref:bound.ref,commit:bound.head,currentRef:bound.currentRef};
 });}catch(error){
  if(started)throw Object.assign(new Error('Branch create outcome unknown; inspect before further action.',{cause:error}),{code:'vcs/branch-create-outcome-unknown',outcomeUnknown:true});
  throw error;
 }
}
