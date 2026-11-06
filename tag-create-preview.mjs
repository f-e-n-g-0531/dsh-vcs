// CURRENT HEAD tag preview and single-use internal apply. Observation barriers
// detect observed changes, not mutation-and-restoration or hostile process atomicity.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {publishTagObject} from './tag-object-publish.mjs';
import {createLocalTag} from './git-tag-create.mjs';
const snapshots=new WeakMap();
import {git as safeGit} from './local-command.mjs';
import {readLatestCommit} from './latest-commit.mjs';
import {encodeGitTag} from './src/git-tag-object.mjs';
import {createVerifiedTagPlan} from './src/verified-tag-plan.mjs';
import {withOperationBudget,currentOperationBudget} from './src/operation-budget.mjs';
const fail=message=>Object.assign(new Error(message),{code:'vcs/tag-create-preview'});
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
/** Exact frozen safe summary only: no raw Buffer, private capability or mutation.
 * Embedded born symbolic HEAD only; packed refs/shared repositories/active hooks
 * and unsupported config are refused. No index or worktree body is opened.
 * All reads share the inherited <=15 second deadline; no temp/object/ref writes.
 */
export async function prepareTagCreate(repo,options={}){
 const r=record(repo,['type','root'],['type','root'],'repository');
 const o=record(options,['name','tagger','message','signal'],['name','tagger','message'],'options');
 if(r.type!=='git'||typeof r.root!=='string'||!path.isAbsolute(r.root)||path.resolve(r.root)!==r.root)throw fail('Canonical Git root required');
 const tagger=record(o.tagger,['name','email','timestamp','timezone'],['name','email','timestamp','timezone'],'tagger');
 let message=o.message;
 if(Buffer.isBuffer(message)){
  if(message.length>64*1024)throw fail('Git tag message byte limit exceeded');
  const copy=Buffer.alloc(message.length);Buffer.prototype.copy.call(message,copy);message=copy;
 }
 // Pure encoder validates every name/identity/message scalar before any I/O.
 encodeGitTag({object:'1'.repeat(40),tag:o.name,tagger,message});
 if(o.signal!==undefined){try{Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,o.signal,[]);}catch{throw fail('Native AbortSignal required');}}
 const name=o.name,ref='refs/tags/'+name;
 return withOperationBudget({signal:o.signal,timeoutMs:15000},async()=>{
  const before=await capture(r.root,name);
  const first=await readLatestCommit({type:r.type,root:r.root});
  // Only the authenticated full fixed OID is ever passed as the raw target.
  if(!(['sha1','sha256'].includes(first.objectFormat))||!(first.objectFormat==='sha1'?/^[a-f0-9]{40}$/:/^[a-f0-9]{64}$/).test(first.head))throw fail('Invalid fixed HEAD');
  const body=await safeGit(r.root,['cat-file','commit',first.head],2*1024*1024);
  const plan=createVerifiedTagPlan(body,{objectFormat:first.objectFormat,target:first.head,tag:name,tagger,message,signal:currentOperationBudget().signal});
  const last=await readLatestCommit({type:r.type,root:r.root});
  const after=await capture(r.root,name);
  if(!equal(first,last)||plan.targetTree!==first.tree||!equal(before,after))throw fail('Stale repository changed during tag preview');
  check();const summary=Object.freeze({action:'tag-create',name,ref,objectFormat:first.objectFormat,head:first.head,currentRef:first.ref,targetTree:plan.targetTree,tagger:plan.tagger,message:plan.message,messageBytes:plan.messageBytes,object:Object.freeze({oid:plan.object.oid}),planId:plan.id});
  snapshots.set(summary,{root:r.root,name,ref,original:before,facts:first,targetBody:Buffer.from(body),tagBody:Buffer.from(plan.object.body),tagOid:plan.object.oid});
  return summary;
 });
}
// Internal writer: caller MUST hold the repository writer exclusion for this entire
// call. Exact-object identity is a one-use capability, not a serializable token.
// Checks observe filesystem versions; external ABA and hostile directory swaps are
// not isolated by portable Node path APIs. Never roll back or auto-retry after start.
export async function applyTagCreate(repo,options={}){
 // Burn before validating ANY other input, callback, cancellation or first await.
 const descriptor=options&&Object.getOwnPropertyDescriptor(options,'snapshot');
 const snapshot=descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
 const saved=snapshots.get(snapshot);snapshots.delete(snapshot);
 if(!saved)throw fail('Invalid or consumed tag snapshot');
 const o=record(options,['snapshot','signal','assertAuthorized','onStart'],['snapshot','assertAuthorized','onStart'],'apply options');
 const r=record(repo,['type','root'],['type','root'],'repository');
 if(r.type!=='git'||r.root!==saved.root||typeof o.assertAuthorized!=='function'||typeof o.onStart!=='function')throw fail('Snapshot repository or callbacks mismatch');
 if(o.signal!==undefined){try{Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,o.signal,[]);}catch{throw fail('Native AbortSignal required');}}
 let started=false;
 try{return await withOperationBudget({signal:o.signal,timeoutMs:15000},async()=>{
  const {root,name,ref,original,facts,targetBody,tagBody,tagOid}=saved,git=path.join(root,'.git');
  const objectPath='objects/'+tagOid.slice(0,2)+'/'+tagOid.slice(2),logPath='logs/'+ref;
  const effectiveConfig=()=>safeGit(root,['--git-dir='+git,'--work-tree='+root,'config','--no-includes','--null','--list'],256*1024);
  const configBaseline=await effectiveConfig();
  const isDir=v=>(Number(v[6])&0o170000)===0o040000;
  const ancestors=files=>new Set(files.flatMap(file=>{const parts=file.split('/'),out=[''];for(let i=1;i<parts.length;i++)out.push(parts.slice(0,i).join('/'));return out;}));
  let appended,createdRows,cas=false;
  function envelope(rows,base,files){
   const before=new Map(base),now=new Map(rows),dirs=ancestors(files);
   for(const [p,v] of before){const n=now.get(p);
    if(!n||!(dirs.has(p)&&isDir(v)?equal([...v.slice(0,3),v[6]],[...n.slice(0,3),n[6]]):equal(v,n)))throw fail('Original metadata changed: '+p);
   }
   for(const [p,v] of rows)if(!before.has(p)&&!files.includes(p)&&!(dirs.has(p)&&isDir(v)))throw fail('Foreign metadata addition: '+p);
  }
  async function exactObject(){
   const [,hex]=await raw(path.join(git,...objectPath.split('/')),128*1024+1024*1024),compressed=Buffer.from(hex,'hex');
   const expected=Buffer.concat([Buffer.from('tag '+tagBody.length+'\0'),tagBody]);let inflated;
   try{inflated=inflateSync(compressed,{maxOutputLength:expected.length,info:true});}catch{throw fail('Invalid appended tag compression');}
   if(inflated.engine.bytesWritten!==compressed.length||!inflated.buffer.equals(expected)||createHash(facts.objectFormat).update(inflated.buffer).digest('hex')!==tagOid)throw fail('Appended tag raw hash/stream mismatch');
  }
  async function verify(phase){
   check();if(!(await effectiveConfig()).equals(configBaseline))throw fail('Effective Git configuration changed');
   const state=await capture(root,name,phase==='cas');
   if(!equal(state.root,original.root)||!equal(state.git,original.git)||!equal(state.head,original.head)||!equal(state.config,original.config))throw fail('Original HEAD/config/identity changed');
   if(phase==='original'){if(!equal(state,original))throw fail('Original metadata changed');}
   else{
    const allowed=phase==='cas'?[objectPath,ref,...(new Map(state.rows).has(logPath)?[logPath]:[])]:[objectPath];
    envelope(state.rows,original.rows,allowed);
    await exactObject();
    if(appended)envelope(state.rows,appended,phase==='cas'?allowed.filter(p=>p!==objectPath):[]);
    if(phase==='cas'&&new Map(state.rows).has(ref)){
     const [,hex]=await raw(path.join(git,...ref.split('/')),4096);
     if(Buffer.from(hex,'hex').toString()!==tagOid+'\n')throw fail('Created ref changed');
     if(new Map(state.rows).has(logPath)){
      const [,logHex]=await raw(path.join(git,...logPath.split('/')),4096);
      if(!new RegExp('^'+'0'.repeat(tagOid.length)+' '+tagOid+' Dsh <dsh@localhost> [0-9]+ [+-][0-9]{4}\\tdsh: create local tag\\n$').test(Buffer.from(logHex,'hex').toString()))throw fail('Created reflog changed');
     }
     if(createdRows&&!equal(state.rows,createdRows))throw fail('Created metadata changed after verification');
     createdRows=state.rows;
    }else if(createdRows)throw fail('Created tag disappeared');
   }
   const [,branchHex]=await raw(path.join(git,...facts.ref.split('/')),4096);
   if(Buffer.from(branchHex,'hex').toString()!==facts.head+'\n')throw fail('Current HEAD facts changed');
   const after=await capture(root,name,phase==='cas');
   if(!equal(after,state))throw fail('Metadata changed during validation');
   check();return state.rows;
  }
  const authorize=async()=>{
   check();const signal=currentOperationBudget().signal;let abort;
   try{await Promise.race([Promise.resolve(o.assertAuthorized()),new Promise((_,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]);check();}
   finally{if(abort)signal.removeEventListener('abort',abort);}
  };
  const start=()=>{if(started)return;started=true;return o.onStart();};
  const originalAuth=async()=>{await verify('original');await authorize();await verify('original');};
  if(!equal(await readLatestCommit({type:'git',root}),facts))throw fail('Current repository facts changed');
  await originalAuth();
  await publishTagObject({gitDirectory:git,objectFormat:facts.objectFormat,target:{oid:facts.head,body:targetBody},tag:{oid:tagOid,body:tagBody},signal:currentOperationBudget().signal,
   assertAuthorized:async()=>{if(!started)await originalAuth();else await authorize();},onStart:start});
  appended=await verify('append');
  await createLocalTag({type:'git',root},{ref,expectedTagOid:tagOid,objectFormat:facts.objectFormat,signal:currentOperationBudget().signal,
   assertAuthorized:async()=>{const phase=cas?'cas':'append';await verify(phase);await authorize();await verify(phase);},
   onStart:()=>{cas=true;return start();}});
  await verify('cas');if(!createdRows)throw fail('Created tag missing');
  await authorize();await verify('cas');check();
  return {name,ref,tagOid,commit:facts.head,currentRef:facts.ref};
 });}catch(cause){
  if(!started)throw cause;
  throw Object.assign(new Error('Append-only tag creation started; inspect repository before further action. Never roll back or retry automatically.',{cause}),{code:'vcs/tag-create-outcome-unknown',appendOnly:true,outcomeUnknown:true});
 }
}
