// Internal confirmation capability. prepare remains read-only; apply requires a caller writer mutex.
// Trusted concurrency excludes raw-ref-type replacement after the last observation;
// Git old-OID CAS is NOT raw-type CAS (docs/BRANCH-DELETE-RAW-REF-RACE.md). No RPC/UI.
// Embedded born symbolic HEAD, direct loose target, no packed refs/shared metadata.
// Observation barriers detect changes, not hostile swaps or mutation-and-restoration.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {readLatestCommit} from './latest-commit.mjs';
import {deleteLocalBranch} from './git-branch-delete.mjs';
import {git} from './local-command.mjs';
import {parseVerifiedCommit} from './src/verified-commit.mjs';
import {createVerifiedBranchDeletePlan} from './src/verified-branch-delete-plan.mjs';
import {withOperationBudget,currentOperationBudget} from './src/operation-budget.mjs';
const capabilities=new WeakMap();
const BODY=2*1024*1024,TOTAL=16*1024*1024,NODES=10000;
const fail=message=>Object.assign(new Error(message),{code:'vcs/branch-delete-preview'});
const check=()=>currentOperationBudget().throwIfExpired();
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const identity=s=>[s.dev,s.ino,s.birthtimeNs].map(String);
const version=s=>[...identity(s),s.size,s.mtimeNs,s.ctimeNs,s.mode].map(String);
const plain=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n;
function record(value,keys,label){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw fail('Invalid '+label+' record');
 const out=Object.create(null);for(const key of Reflect.ownKeys(value)){
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

const forbidden=new Set(['packed-refs','reftable','commondir','gitdir','shallow','config.worktree','MERGE_HEAD','MERGE_MSG','CHERRY_PICK_HEAD','REVERT_HEAD','REBASE_HEAD','BISECT_LOG','BISECT_START','rebase-merge','rebase-apply','sequencer','worktrees','info/sparse-checkout','info/attributes','objects/info/alternates','objects/info/http-alternates'].map(s=>s.toLowerCase()));
async function metadata(directory){
 const rows=[];let nodes=0;
 async function visit(file,relative){
  check();if(++nodes>20000)throw fail('Metadata inspection limit exceeded');
  const key=relative.toLowerCase();
  if(forbidden.has(key)||key.endsWith('.lock')||key.endsWith('.promisor')||key.startsWith('sharedindex.')||key.startsWith('hooks/')&&!key.endsWith('.sample'))throw fail('Unsupported repository metadata: '+relative);
  const s=await fs.lstat(file,{bigint:true});
  if(s.isSymbolicLink()||(!s.isDirectory()&&!plain(s))||await fs.realpath(file)!==file)throw fail('Linked or special repository metadata');
  rows.push([relative,version(s)]);
  if(s.isDirectory()){const names=await fs.readdir(file);check();if(names.length>20000-nodes)throw fail('Metadata inspection limit exceeded');for(const name of names.sort())await visit(path.join(file,name),relative?relative+'/'+name:name);}
 }
 await visit(directory,'');return rows;
}

// Pin effective system/global/local configuration without expanding includes.
const effectiveConfig=root=>git(root,['--git-dir='+path.join(root,'.git'),'--work-tree='+root,'config','--no-includes','--null','--list'],256*1024);
async function capture(root,name){
 check();const rootStat=await directory(root),gitDir=path.join(root,'.git');await directory(gitDir);
 const rows=await metadata(gitDir);
 const entries=await fs.readdir(gitDir);
 for(const expected of ['HEAD','config','refs','logs','objects','hooks'])if(entries.some(n=>n.toLowerCase()===expected.toLowerCase()&&n!==expected))throw fail('Noncanonical metadata spelling');
 let parent=gitDir;const parts=['refs','heads',...name.split('/')];
 for(let i=0;i<parts.length;i++){
  check();const part=parts[i],matches=(await fs.readdir(parent)).filter(n=>n.toLowerCase()===part.toLowerCase());
  if(matches.length!==1||matches[0]!==part)throw fail('Missing target or portable namespace collision');
  const file=path.join(parent,part);
  if(i<parts.length-1)await directory(file);
  parent=file;
 }
 const head=await raw(path.join(gitDir,'HEAD'),4096),config=await raw(path.join(gitDir,'config'),256*1024),target=await raw(parent,65);
 if(!equal(rows,await metadata(gitDir)))throw fail('Stale repository metadata during capture');
 check();return {root:identity(rootStat),rows,head,config,target};
}
/** Strict own-data repo {type:'git',root} and options {name,signal?} only.
 * 15s shared budget; <=20k metadata entries/scan, <=10k commits, <=2MiB/body,
 * <=16MiB graph. All parents of BOTH tips must exist and pass strict verification.
 * No worktree or index body opens. No network/lazy fetch. No force operation.
 */
export async function prepareBranchDelete(repo,options={}){
 const r=record(repo,['type','root'],'repository'),o=record(options,['name','signal'],'options');
 if(r.type!=='git'||typeof r.root!=='string'||!path.isAbsolute(r.root)||path.resolve(r.root)!==r.root)throw fail('Canonical Git root required');
 validateName(o.name);
 if(o.signal!==undefined){try{Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,o.signal,[]);}catch{throw fail('Native AbortSignal required');}}
 const name=o.name,ref='refs/heads/'+name;
 return withOperationBudget({signal:o.signal,timeoutMs:15000},async()=>{
  const before=await capture(r.root,name),configBaseline=await effectiveConfig(r.root);
  const first=await readLatestCommit({type:r.type,root:r.root},{signal:o.signal});
  validateName(first.ref.slice(11));
  if(first.ref.toLowerCase()===ref.toLowerCase())throw fail('Cannot delete current branch or case-insensitive alias');
  const text=Buffer.from(before.target[1],'hex').toString('latin1'),width=first.objectFormat==='sha1'?40:64;
  if(!new RegExp('^[0-9a-f]{'+width+'}\\n?$').test(text)||/^0+\n?$/.test(text))throw fail('Target requires direct raw object id');
  const oid=text.replace(/\n$/,''),current={ref:first.ref,oid:first.head},target={ref,oid};
  const currentRaw=await raw(path.join(r.root,'.git',...current.ref.split('/')),65);
  if(![current.oid,current.oid+'\n'].some(value=>Buffer.from(value).toString('hex')===currentRaw[1]))throw fail('Stale direct current ref');
  if(!equal(before,await capture(r.root,name)))throw fail('Stale repository before traversal');
  const queue=[...new Set([current.oid,target.oid])],seen=new Set(queue),objects=[];let total=0;
  for(let i=0;i<queue.length;i++){
   check();const oid=queue[i],body=await git(r.root,['cat-file','commit',oid],Math.min(BODY,TOTAL-total||1));
   check();total+=body.length;if(total>TOTAL)throw fail('Aggregate object body byte limit exceeded');
   const parsed=parseVerifiedCommit(body,{oid,objectFormat:first.objectFormat,signal:currentOperationBudget().signal});
   objects.push({oid,body});
   for(const parent of parsed.parents)if(!seen.has(parent)){
    if(seen.size>=NODES)throw fail('Commit node limit exceeded');seen.add(parent);queue.push(parent);
   }
  }
  if(!equal(before,await capture(r.root,name)))throw fail('Stale repository after traversal');
  const last=await readLatestCommit({type:r.type,root:r.root},{signal:o.signal});
  if(!equal(first,last)||!(await effectiveConfig(r.root)).equals(configBaseline)||!equal(currentRaw,await raw(path.join(r.root,'.git',...current.ref.split('/')),65))||!equal(before,await capture(r.root,name)))throw fail('Stale current facts or repository');
  check();const plan=createVerifiedBranchDeletePlan({objectFormat:first.objectFormat,current,target,objects,signal:currentOperationBudget().signal});
  check();const summary=Object.freeze({action:'branch-delete',name,ref,objectFormat:plan.objectFormat,current:plan.current,target:plan.target,merged:true,proof:plan.proof,planId:plan.id});
  capabilities.set(summary,{root:r.root,name,ref,before,configBaseline,currentRaw,current,target,objectFormat:first.objectFormat,planId:plan.id});
  return summary;
 });
}

/** Internal only. Caller MUST hold the repository writer mutex and supply trusted
 * callbacks. Exact summary identity is consumed synchronously, including invalid
 * attempts. No clone, replay, overrides, rollback, checkout or graph recomputation.
 * Full metadata versions pin the already hash-authenticated merged graph; this is
 * observation safety, not hostile swaps/ABA isolation or atomic raw-ref-type CAS.
 */
export async function applyBranchDelete(repo,options={}){
 // Burn before record validation or any await; do not invoke a snapshot accessor.
 const descriptor=options&&(typeof options==='object'||typeof options==='function')?Object.getOwnPropertyDescriptor(options,'snapshot'):undefined;
 const snapshot=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 const authority=capabilities.get(snapshot);
 if(authority)capabilities.delete(snapshot);
 if(!authority)throw fail('Exact unused branch-delete snapshot required');
 const r=record(repo,['type','root'],'repository');
 const o=record(options,['snapshot','signal','assertAuthorized','onStart'],'options');
 if(r.type!=='git'||r.root!==authority.root||typeof o.assertAuthorized!=='function'||typeof o.onStart!=='function')throw fail('Bound repository and authorization/start callbacks required');
 if(o.signal!==undefined){try{Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,o.signal,[]);}catch{throw fail('Native AbortSignal required');}}
 const {root,name,ref,before,configBaseline,currentRaw,current,target,objectFormat}=authority;
 const bound={type:'git',root};let started=false;
 async function facts(){
  if(!(await effectiveConfig(root)).equals(configBaseline))throw fail('Effective Git configuration changed');
  // Format/policy were established by the full reader; retain EXACT prepare bytes.
  if(!equal(currentRaw,await raw(path.join(root,'.git',...current.ref.split('/')),65)))throw fail('Original direct current ref changed');
 }
 async function fresh(){
  check();if(!equal(before,await capture(root,name)))throw fail('Stale branch-delete snapshot');
  await facts();
  if(!equal(before,await capture(root,name)))throw fail('Stale authenticated current facts');
  check();
 }
 const removed=new Set([ref,'logs/'+ref]),ancestors=new Set(['']);
 for(const leaf of removed){let p=leaf;while(p.includes('/')){p=p.slice(0,p.lastIndexOf('/'));ancestors.add(p);}}
 const original=new Map(before.rows);
 async function deleted(){
  check();const gitDir=path.join(root,'.git');
  if(!equal(identity(await directory(root)),before.root))throw fail('Repository identity changed');
  await directory(gitDir);const rows=await metadata(gitDir),now=new Map(rows);
  for(const leaf of removed)if(now.has(leaf)||await stat(path.join(gitDir,...leaf.split('/'))))throw fail('Deleted target or reflog reappeared');
  for(const [key,v] of rows){
   const old=original.get(key);if(!old)throw fail('Unrelated metadata added');
   if(ancestors.has(key)){
    // Existing ancestor directories retain identity/type/mode, not size/times.
    if(!equal(v.slice(0,3),old.slice(0,3))||v[6]!==old[6])throw fail('Ancestor directory replaced');
   }else if(!equal(v,old))throw fail('Unrelated metadata changed');
  }
  for(const [key,v] of before.rows)if(!now.has(key)&&!removed.has(key)){
   if(!key||!ancestors.has(key)||(BigInt(v[6])&0o170000n)!==0o040000n)throw fail('Unrelated metadata disappeared');
   // Only ancestors made empty by the exact two removals may be pruned.
   for(const [child] of before.rows)if(child.startsWith(key+'/')&&!removed.has(child)&&!ancestors.has(child))throw fail('Nonempty ancestor disappeared');
  }
  if(!equal(await raw(path.join(gitDir,'HEAD'),4096),before.head)||!equal(await raw(path.join(gitDir,'config'),256*1024),before.config))throw fail('Original HEAD/config changed');
  await facts();
  if(!equal(rows,await metadata(gitDir)))throw fail('Stale post-delete metadata');
  check();
 }
 // Trusted authorization may remain pending. Race only its wait, never continue
 // mutation after cancellation; Promise.race also observes a late rejection.
 const authorization=async()=>{
  check();const signal=currentOperationBudget().signal;let abort;
  const cancelled=new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  try{await Promise.race([Promise.resolve().then(()=>{check();return o.assertAuthorized();}),cancelled]);check();}
  finally{signal.removeEventListener('abort',abort);}
 };
 const authorize=async()=>{
  if(started){await deleted();await authorization();check();await deleted();}
  else{await fresh();await authorization();check();await fresh();}
 };
 try{
  return await withOperationBudget({signal:o.signal,timeoutMs:15000},async()=>{
   // One full policy/hash authentication; every later barrier retains prepare baselines.
   await fresh();
   const latest=await readLatestCommit(bound,{signal:o.signal});
   if(latest.ref!==current.ref||latest.head!==current.oid||latest.objectFormat!==objectFormat)throw fail('Stale authenticated current facts');
   await fresh();
   await deleteLocalBranch(bound,{ref,expectedOid:target.oid,objectFormat,signal:o.signal,assertAuthorized:authorize,onStart:()=>{started=true;return o.onStart();}});
   await deleted();await authorize();await deleted();check();
   return Object.freeze({name,ref,deletedOid:target.oid,currentRef:current.ref,currentOid:current.oid});
  });
 }catch(cause){
  if(started)throw Object.assign(new Error('Branch deletion outcome is unknown; inspect before any further action.',{cause}),{code:'vcs/branch-delete-outcome-unknown',outcomeUnknown:true});
  throw cause;
 }
}
