// Internal preview and single-use apply. Caller owns repository writer exclusion.
// Observation barriers do not isolate hostile directory swaps or external ABA.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {git as safeGit} from './local-command.mjs';
import {readLatestCommit} from './latest-commit.mjs';
import {createVerifiedLightweightTagPlan} from './src/lightweight-tag-plan.mjs';
import {withOperationBudget,currentOperationBudget} from './src/operation-budget.mjs';
import {createLightweightTag} from './git-lightweight-tag-create.mjs';
const snapshots=new WeakMap();
const fail=message=>Object.assign(new Error(message),{code:'vcs/lightweight-tag-preview'});
const check=()=>currentOperationBudget().throwIfExpired();
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const identity=s=>[s.dev,s.ino,s.birthtimeNs].map(String);
const version=s=>[...identity(s),s.size,s.mtimeNs,s.ctimeNs,s.mode].map(String);
const plain=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n;
function record(value,keys,required,label){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw fail('Invalid '+label+' record');
 const out=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||!keys.includes(key))throw fail('Unsupported '+label+' field');
  const d=Object.getOwnPropertyDescriptor(value,key);
  if(!d||!Object.hasOwn(d,'value'))throw fail(label+' requires own data properties');
  out[key]=d.value;
 }
 for(const key of required)if(!Object.hasOwn(out,key))throw fail('Missing '+label+' '+key);
 return out;
}
async function directory(file){
 check();const s=await fs.lstat(file,{bigint:true});
 if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(file)!==file)throw fail('Canonical metadata directory required');
 return s;
}
async function raw(file,max){
 check();const before=await fs.lstat(file,{bigint:true});
 if(!plain(before)||before.size>BigInt(max))throw fail('Bounded single-link metadata file required');
 const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const opened=await handle.stat({bigint:true});
  if(!plain(opened)||!equal(version(before),version(opened)))throw fail('Stale metadata opening');
  const bytes=Buffer.alloc(max+1);let n=0;
  while(n<bytes.length){check();const r=await handle.read(bytes,n,bytes.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}
  const after=await handle.stat({bigint:true}),now=await fs.lstat(file,{bigint:true});
  if(n>max||!plain(now)||!equal(version(opened),version(after))||!equal(version(after),version(now))||BigInt(n)!==after.size)throw fail('Stale metadata reading');
  return [version(after),bytes.subarray(0,n).toString('hex')];
 }finally{await handle.close();}
}
const forbidden=new Set(['packed-refs','reftable','commondir','gitdir','shallow','config.worktree','MERGE_HEAD','MERGE_MSG','CHERRY_PICK_HEAD','REVERT_HEAD','REBASE_HEAD','BISECT_LOG','BISECT_START','rebase-merge','rebase-apply','sequencer','worktrees','info/sparse-checkout','info/attributes','objects/info/alternates','objects/info/http-alternates'].map(s=>s.toLowerCase()));
async function metadata(git){
 const rows=[];let nodes=0;
 async function visit(file,rel){
  check();if(++nodes>20000)throw fail('Metadata inspection limit exceeded');
  const key=rel.toLowerCase();
  if(forbidden.has(key)||key.endsWith('.lock')||key.endsWith('.promisor')||key.startsWith('sharedindex.')||key.startsWith('hooks/')&&!key.endsWith('.sample'))throw fail('Unsupported repository metadata: '+rel);
  const s=await fs.lstat(file,{bigint:true});
  if(s.isSymbolicLink()||(!s.isDirectory()&&!plain(s))||await fs.realpath(file)!==file)throw fail('Linked or special repository metadata');
  rows.push([rel,version(s)]);
  if(s.isDirectory()){
   const entries=await fs.readdir(file);
   // Reject an excessive immediate fanout before sorting or visiting any child.
   if(entries.length>20000-nodes)throw fail('Metadata inspection limit exceeded');
   for(const name of entries.sort())await visit(path.join(file,name),rel?rel+'/'+name:name);
  }
 }
 await visit(git,'');return rows;
}
function absence(rows,name){
 const entries=new Map(rows);
 for(const parts of [['refs','tags',...name.split('/')],['logs','refs','tags',...name.split('/')]]){
  let parent='';
  for(let i=0;i<parts.length;i++){
   const target=parent?parent+'/'+parts[i]:parts[i];
   const matches=rows.filter(([rel])=>rel.toLowerCase()===target.toLowerCase());
   if(!matches.length)break;
   if(matches.length!==1||matches[0][0]!==target||i===parts.length-1)throw fail('Portable target namespace collision');
   const v=entries.get(target);
   if((Number(v[6])&0o170000)!==0o040000)throw fail('Target prefix or reflog collision');
   parent=target;
  }
 }
 for(const expected of ['HEAD','config','refs','logs'])if(rows.some(([rel])=>rel.toLowerCase()===expected.toLowerCase()&&rel!==expected))throw fail('Noncanonical metadata spelling');
}
async function capture(root,name,created=false){
 const rootStat=await directory(root),git=path.join(root,'.git'),gitStat=await directory(git);
 const rows=await metadata(git);if(!created)absence(rows,name);
 const head=await raw(path.join(git,'HEAD'),4096),config=await raw(path.join(git,'config'),256*1024);
 const closing=await metadata(git);if(!created)absence(closing,name);
 if(!equal(rows,closing)||!equal(identity(rootStat),identity(await directory(root)))||!equal(identity(gitStat),identity(await directory(git))))throw fail('Stale repository during capture');
 check();return {root:identity(rootStat),git:identity(gitStat),head,config,rows};
}
// Observation barriers do not isolate external ABA or hostile directory swaps.
// Embedded born symbolic HEAD, loose absent tag namespace; <=20k metadata entries.
export async function prepareLightweightTagCreate(repo,options={}){
 const r=record(repo,['type','root'],['type','root'],'repository');
 const o=record(options,['name','signal'],['name'],'options');
 if(r.type!=='git'||typeof r.root!=='string'||!path.isAbsolute(r.root)||path.resolve(r.root)!==r.root)throw fail('Canonical Git root required');
 // Validate names before I/O using the same pure policy; no fake object is published.
 const name=o.name;
 if(typeof name!=='string'||!name||Buffer.from(name,'utf8').toString('utf8')!==name||Buffer.byteLength(name)>1000||name==='@'||name.toUpperCase()==='HEAD'||name.startsWith('-')||name.startsWith('refs/'))throw fail('Safe portable short tag name required');
 const forbiddenChars=/[\x00-\x20\x7f~^:?*\[\\<>"|\p{Cc}\p{Cf}]/u;
 if(forbiddenChars.test(name)||name.includes('..')||name.includes('@{')||name.split('/').some(p=>!p||Buffer.byteLength(p)>255||p.startsWith('.')||/[. ]$/.test(p)||p.toLowerCase().endsWith('.lock')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw fail('Safe portable short tag name required');
 if(o.signal!==undefined){try{Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,o.signal,[]);}catch{throw fail('Native AbortSignal required');}}
 return withOperationBudget({signal:o.signal,timeoutMs:15000},async()=>{
  const before=await capture(r.root,name),first=await readLatestCommit({type:r.type,root:r.root});
  const body=await safeGit(r.root,['cat-file','commit',first.head],2*1024*1024);
  const plan=createVerifiedLightweightTagPlan(body,{objectFormat:first.objectFormat,target:first.head,name,signal:currentOperationBudget().signal});
  const last=await readLatestCommit({type:r.type,root:r.root}),after=await capture(r.root,name);
  if(!equal(first,last)||plan.targetTree!==first.tree||!equal(before,after))throw fail('Stale repository changed during lightweight tag preview');
  check();const summary=Object.freeze({action:plan.action,name,ref:plan.ref,objectFormat:plan.objectFormat,head:plan.target,currentRef:first.ref,targetTree:plan.targetTree,planId:plan.id});
  snapshots.set(summary,{root:r.root,name,ref:plan.ref,original:before,facts:first,body:Buffer.from(body)});
  return summary;
 });
}

// Exact summary identity is a single-use capability; caller MUST hold writer exclusion.
// Never retry or roll back after the synchronous start boundary.
export async function applyLightweightTagCreate(repo,options={}){
 const descriptor=options&&Object.getOwnPropertyDescriptor(options,'snapshot');
 const snapshot=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 const saved=snapshots.get(snapshot);snapshots.delete(snapshot);
 if(!saved)throw fail('Invalid or consumed lightweight tag snapshot');
 const o=record(options,['snapshot','signal','assertAuthorized','onStart'],['snapshot','assertAuthorized','onStart'],'apply options');
 const r=record(repo,['type','root'],['type','root'],'repository');
 if(r.type!=='git'||r.root!==saved.root||typeof o.assertAuthorized!=='function'||typeof o.onStart!=='function')throw fail('Snapshot repository or callbacks mismatch');
 if(o.signal!==undefined){try{Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,o.signal,[]);}catch{throw fail('Native AbortSignal required');}}
 let started=false;
 try{return await withOperationBudget({signal:o.signal,timeoutMs:15000},async()=>{
  const {root,name,ref,original,facts}=saved,git=path.join(root,'.git'),logPath='logs/'+ref;
  const effectiveConfig=()=>safeGit(root,['--git-dir='+git,'--work-tree='+root,'config','--no-includes','--null','--list'],256*1024);
  const configBaseline=await effectiveConfig();
  const isDir=v=>(Number(v[6])&0o170000)===0o040000;
  let createdRows;
  function envelope(rows){
   const before=new Map(original.rows),now=new Map(rows),files=[ref,...(now.has(logPath)?[logPath]:[])];
   const dirs=new Set(files.flatMap(file=>{const parts=file.split('/'),out=[''];for(let i=1;i<parts.length;i++)out.push(parts.slice(0,i).join('/'));return out;}));
   for(const [p,v] of before){const n=now.get(p);
    if(!n||!(dirs.has(p)&&isDir(v)?equal([...v.slice(0,3),v[6]],[...n.slice(0,3),n[6]]):equal(v,n)))throw fail('Original metadata changed: '+p);
   }
   for(const [p,v] of rows)if(!before.has(p)&&!files.includes(p)&&!(dirs.has(p)&&isDir(v)))throw fail('Foreign metadata addition: '+p);
  }
  async function verify(){
   check();if(!(await effectiveConfig()).equals(configBaseline))throw fail('Effective Git configuration changed');
   const state=await capture(root,name,started);
   if(!equal(state.root,original.root)||!equal(state.git,original.git)||!equal(state.head,original.head)||!equal(state.config,original.config))throw fail('Original HEAD/config/identity changed');
   if(!started){if(!equal(state,original))throw fail('Original metadata changed');}
   else{
    envelope(state.rows);
    if(!new Map(state.rows).has(ref))throw fail('Created lightweight tag missing');
    const [,hex]=await raw(path.join(git,...ref.split('/')),4096);
    if(Buffer.from(hex,'hex').toString()!==facts.head+'\n')throw fail('Created ref changed');
    if(new Map(state.rows).has(logPath)){
     const [,hex]=await raw(path.join(git,...logPath.split('/')),4096);
     if(!new RegExp('^'+'0'.repeat(facts.head.length)+' '+facts.head+' Dsh <dsh@localhost> [0-9]+ [+-][0-9]{4}\\tdsh: create lightweight tag\\n$').test(Buffer.from(hex,'hex').toString()))throw fail('Created reflog changed');
    }
    if(createdRows&&!equal(state.rows,createdRows))throw fail('Created metadata changed after verification');
    createdRows=state.rows;
   }
   const [,branchHex]=await raw(path.join(git,...facts.ref.split('/')),4096);
   if(Buffer.from(branchHex,'hex').toString()!==facts.head+'\n')throw fail('Current HEAD facts changed');
   const closing=await capture(root,name,started);
   if(!equal(closing,state))throw fail('Metadata changed during validation');
   check();
  }
  const authorize=async()=>{
   check();const signal=currentOperationBudget().signal;let abort;
   try{await Promise.race([Promise.resolve(o.assertAuthorized()),new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);check();}
   finally{if(abort)signal.removeEventListener('abort',abort);}
  };
  const authorized=async()=>{await verify();await authorize();await verify();};
  // Authenticate full current facts once; original metadata pins the target object.
  // The low-level writer authenticates the target bytes again before zero-old CAS.
  if(!equal(await readLatestCommit({type:'git',root}),facts))throw fail('Current repository facts changed');
  await authorized();
  await createLightweightTag({type:'git',root},{ref,expectedCommitOid:facts.head,objectFormat:facts.objectFormat,signal:currentOperationBudget().signal,
   assertAuthorized:authorized,onStart:()=>{if(started)throw fail('Duplicate lightweight tag start');started=true;return o.onStart();}});
  await verify();await authorize();await verify();check();
  return {name,ref,commit:facts.head,currentRef:facts.ref};
 });}catch(cause){
  if(!started)throw cause;
  throw Object.assign(new Error('Lightweight tag creation started; inspect repository before further action. Never roll back or retry automatically.',{cause}),{code:'vcs/lightweight-tag-create-outcome-unknown',outcomeUnknown:true});
 }
}
