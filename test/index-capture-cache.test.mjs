import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {git} from '../local-command.mjs';
import {prepareIndexStage,applyIndexStage,prepareIndexUnstage,applyIndexUnstage} from '../index-change.mjs';
import {withOperationBudget,currentOperationBudget} from '../src/operation-budget.mjs';

// Count real Git launches, never substitute command output or the adapter itself.
const originalSpawn=cp.spawn;
let observer;
cp.spawn=(command,args,options)=>{
  const child=originalSpawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-cache-absent-global')}});
  if(command==='git')observer?.(args.slice(4),child);
  return child;
};
syncBuiltinESMExports();
test.after(()=>{cp.spawn=originalSpawn;syncBuiltinESMExports();});
test.afterEach(()=>{observer=undefined;});
async function fixture(t,action='unstage',format='sha1'){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-capture-cache-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
  const run=(...args)=>git(root,args),write=(file,text)=>fs.writeFile(path.join(root,file),text);
  await run('init','--object-format='+format);
  for(const [k,v] of [['user.name','Cache Test'],['user.email','cache@example.invalid'],['core.autocrlf','false'],['core.safecrlf','false'],['commit.gpgsign','false']])await run('config',k,v);
  await write('selected','base\n');await write('other','other\n');await run('add','.');await run('commit','-m','base');
  await write('selected','changed\n');if(action==='unstage')await run('add','selected');
  const repo={type:'git',root},prepare=options=>(action==='stage'?prepareIndexStage:prepareIndexUnstage)(repo,{path:'selected',...options});
  const apply=(snapshot,options)=>(action==='stage'?applyIndexStage:applyIndexUnstage)(repo,{snapshot,assertAuthorized:()=>{},onStart:()=>{},...options});
  return {root,run,write,prepare,apply,index:()=>fs.readFile(path.join(root,'.git','index'))};
}
async function measured(work){
  const commands=[];observer=args=>commands.push(args);
  try{return {value:await work(),commands};}finally{observer=undefined;}
}
function counts(commands){return Object.fromEntries(['config','rev-parse','check-ref-format','check-attr','ls-tree','cat-file'].map(name=>[name,commands.filter(a=>a[0]===name).length]));}
function verifyCounts(t,commands,reads){
  const c=counts(commands),captures=c.config;
  assert.ok(captures>reads);assert.equal(c['ls-tree'],reads);assert.equal(c['cat-file'],reads);
  assert.equal(c['rev-parse'],captures);assert.equal(c['check-ref-format'],1);assert.equal(c['check-attr'],captures);
  assert.equal(commands.length,captures*3+1+reads*2);
  t.diagnostic(JSON.stringify({captures,immutableReads:reads,oldCommands:captures*8,newCommands:commands.length,saved:captures*5-1-reads*2}));
}
for(const format of ['sha1','sha256'])for(const action of ['stage','unstage'])test(action+' private cache real spawn counts '+format,async t=>{
  const f=await fixture(t,action,format);
  const first=await measured(()=>f.prepare());verifyCounts(t,first.commands,1);
  // A new public call/grant starts cold even when every byte is identical.
  const second=await measured(()=>f.prepare());verifyCounts(t,second.commands,1);
  const applied=await measured(()=>f.apply(second.value));verifyCounts(t,applied.commands,action==='stage'?2:1);
});
for(const mutation of ['config','head','work','index','metadata','missing blob','corrupt blob'])test('prepare still rejects '+mutation+' between captures',async t=>{
  const f=await fixture(t),before=await f.index();
  const blob=(await f.run('rev-parse','HEAD:selected')).toString().trim(),blobPath=path.join(f.root,'.git','objects',blob.slice(0,2),blob.slice(2));
  let configs=0,mutated=false;
  const mutate=()=>{
    mutated=true;
    if(mutation==='config')sync.appendFileSync(path.join(f.root,'.git','config'),'\n[filter "unsafe"]\n clean = unsafe\n');
    if(mutation==='head')sync.writeFileSync(path.join(f.root,'.git','HEAD'),'ref: refs/heads/missing\n');
    if(mutation==='work')sync.writeFileSync(path.join(f.root,'other'),'raced\n');
    if(mutation==='index'){const b=Buffer.from(before);b[12]^=1;sync.writeFileSync(path.join(f.root,'.git','index'),b);}
    if(mutation==='metadata')sync.writeFileSync(path.join(f.root,'.git','foreign'),'new metadata');
    if(mutation==='missing blob')sync.unlinkSync(blobPath);
    if(mutation==='corrupt blob'){sync.chmodSync(blobPath,0o600);sync.writeFileSync(blobPath,'corrupt');}
  };
  observer=(args,child)=>{
    if(args[0]==='config'&&++configs===2&&['work','index'].includes(mutation))mutate();
    if(args[0]==='check-attr'&&configs===1&&!['work','index'].includes(mutation))child.prependOnceListener('close',mutate);
  };
  await assert.rejects(f.prepare());assert.equal(mutated,true);
  observer=undefined;if(mutation!=='index')assert.deepEqual(await f.index(),before);
});
for(const mutation of ['config','head','work','metadata','authorization'])test('apply revalidates after cache warmup: '+mutation,async t=>{
  const f=await fixture(t),snapshot=await f.prepare(),before=await f.index();let calls=0,started=false;
  await assert.rejects(f.apply(snapshot,{onStart:()=>{started=true;},assertAuthorized:async()=>{
    if(++calls!==2)return;
    if(mutation==='authorization')throw Error('revoked');
    if(mutation==='config')await fs.appendFile(path.join(f.root,'.git','config'),'\n[filter "unsafe"]\n clean = unsafe\n');
    if(mutation==='head')await fs.writeFile(path.join(f.root,'.git','HEAD'),'ref: refs/heads/missing\n');
    if(mutation==='work')await f.write('other','raced');
    if(mutation==='metadata')await fs.writeFile(path.join(f.root,'.git','foreign'),'raced');
  }}));
  assert.equal(started,false);assert.deepEqual(await f.index(),before);
});
for(const kind of ['cancel','deadline'])test('warm cache observes '+kind+' before publication',async t=>{
  const f=await fixture(t),snapshot=await f.prepare(),before=await f.index(),controller=new AbortController();let calls=0,started=false;
  const work=()=>f.apply(snapshot,{signal:controller.signal,onStart:()=>{started=true;},assertAuthorized:()=>{
    if(++calls!==2)return;
    if(kind==='cancel')controller.abort();else currentOperationBudget().throwIfExpired=()=>{throw Object.assign(Error('expired shared operation budget'),{code:'TIMEOUT'});};
  }});
  await assert.rejects(kind==='deadline'?withOperationBudget({timeoutMs:15000},work):work(),kind==='deadline'?{code:'TIMEOUT'}:undefined);
  assert.equal(started,false);assert.deepEqual(await f.index(),before);
});
test('warm post-publication cache preserves unknown cancellation contract',async t=>{
  const f=await fixture(t),snapshot=await f.prepare(),controller=new AbortController();let started=false;
  await assert.rejects(f.apply(snapshot,{signal:controller.signal,onStart:()=>{started=true;},assertAuthorized:()=>{if(started)controller.abort();}}),e=>e.code==='vcs/index-outcome-unknown'&&e.outcomeUnknown===true);
});
