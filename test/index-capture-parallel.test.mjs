import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {git} from '../local-command.mjs';
import {prepareIndexStage,applyIndexStage} from '../index-change.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';

// Real commands and real output throughout. Barriers hold only close delivery,
// making overlap deterministic even when a tiny Git read exits immediately.
const originalSpawn=cp.spawn,originalOpen=fs.open;
let observe,observeOpen,transform;
cp.spawn=(command,args,options)=>{
  const actual=command==='git'?(transform?.(args)??args):args;
  const child=originalSpawn(command,actual,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-parallel-absent-global')}});
  if(command==='git')observe?.(args.slice(4),child);
  return child;
};
fs.open=async(...args)=>{observeOpen?.(args[0]);return originalOpen(...args);};
syncBuiltinESMExports();
test.after(()=>{cp.spawn=originalSpawn;fs.open=originalOpen;syncBuiltinESMExports();});
test.afterEach(()=>{observe=observeOpen=transform=undefined;});
async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-capture-parallel-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
  const run=(...args)=>git(root,args);
  await run('init');
  for(const [key,value] of [['user.name','Parallel Test'],['user.email','parallel@example.invalid'],['core.autocrlf','false'],['core.safecrlf','false'],['commit.gpgsign','false']])await run('config',key,value);
  await fs.writeFile(path.join(root,'selected'),'base\n');await run('add','.');await run('commit','-m','base');
  await fs.writeFile(path.join(root,'selected'),'changed\n');
  const repo={type:'git',root};
  return {root,run,prepare:options=>prepareIndexStage(repo,{path:'selected',...options}),apply:(snapshot,options)=>applyIndexStage(repo,{snapshot,assertAuthorized:()=>{},onStart:()=>{},...options})};
}
function holdClose(child){
  const emit=child.emit;let closed,release=false;
  child.emit=function(event,...args){if(event==='close'&&!release){closed=args;return true;}return emit.call(this,event,...args);};
  return ()=>{release=true;if(closed){const args=closed;closed=undefined;emit.call(child,'close',...args);}};
}
function barrier(t){
  let release,expired=false;
  const timer=setTimeout(()=>{expired=true;release?.();},3000);
  t.after(()=>{clearTimeout(timer);release?.();});
  return {hold(child){release=holdClose(child);},release(){clearTimeout(timer);release?.();},verify(){assert.equal(expired,false,'independent read waited for its sibling close');}};
}
function track(){
  const pending=new Set(),commands=[];
  return {pending,commands,observe(args,child){commands.push(args[0]);pending.add(child);child.once('close',()=>pending.delete(child));}};
}

test('root facts overlap bounded index and HEAD reads after config',async t=>{
  const f=await fixture(t),gate=barrier(t),opened=new Set(),seen=track();let held=false;
  observe=(args,child)=>{seen.observe(args,child);if(args[0]==='rev-parse'&&!held){held=true;gate.hold(child);}};
  observeOpen=file=>{if(held&&['index','HEAD'].includes(path.basename(file))){opened.add(path.basename(file));if(opened.size===2)gate.release();}};
  await f.prepare();gate.verify();assert.deepEqual([...opened].sort(),['HEAD','index']);assert.equal(seen.pending.size,0);
});

for(const [first,second] of [['check-ref-format','ls-tree'],['cat-file','check-attr']])test(first+' overlaps '+second+' with unchanged real command counts',async t=>{
  const f=await fixture(t),gate=barrier(t),seen=track();let held=false,joined=false;
  observe=(args,child)=>{seen.observe(args,child);if(args[0]===first&&!held){held=true;gate.hold(child);}if(args[0]===second&&held&&!joined){joined=true;gate.release();}};
  await f.prepare();gate.verify();assert.equal(joined,true);assert.equal(seen.pending.size,0);
  assert.equal(seen.commands.length,9);
  for(const name of ['config','rev-parse','check-attr'])assert.equal(seen.commands.filter(x=>x===name).length,2);
  for(const name of ['check-ref-format','ls-tree','cat-file'])assert.equal(seen.commands.filter(x=>x===name).length,1);
});

test('parallel failures drain siblings and keep ref error ahead of tree error',async t=>{
  const f=await fixture(t),seen=track();let release,treeClosed=false;
  // Both real Git commands fail. Delay the lower-priority tree close so an
  // early-reject Promise.all implementation would leave an unsettled runner.
  transform=args=>args[4]==='check-ref-format'?[...args.slice(0,5),'invalid..ref']:args[4]==='ls-tree'?[...args.slice(0,5),'not-an-object']:args;
  observe=(args,child)=>{seen.observe(args,child);if(args[0]==='ls-tree'){release=holdClose(child);child.once('close',()=>{treeClosed=true;});setTimeout(release,80);}};
  await assert.rejects(f.prepare(),e=>e.code==='VCS_COMMAND'&&!e.message.includes('not-an-object'));
  assert.equal(treeClosed,true);assert.equal(seen.pending.size,0);assert.ok(!seen.commands.includes('cat-file'));
});

test('facts validation retains priority over an independently read malformed index',async t=>{
  const f=await fixture(t),seen=track();
  await fs.writeFile(path.join(f.root,'.git','index'),'invalid index');
  transform=args=>args[4]==='rev-parse'?[...args.slice(0,5),'--verify','not-a-commit']:args;
  observe=seen.observe;
  await assert.rejects(f.prepare(),e=>e.code==='vcs/index-unsupported'&&e.message.includes('Born HEAD'));
  assert.equal(seen.pending.size,0);assert.ok(!seen.commands.includes('check-ref-format'));
});

test('object-type error retains priority over parallel attribute command error',async t=>{
  const f=await fixture(t),seen=track();
  transform=args=>args[4]==='cat-file'?[...args.slice(0,5),'-t','not-an-object']:args[4]==='check-attr'?[...args.slice(0,5),'--invalid-option']:args;
  observe=seen.observe;
  await assert.rejects(f.prepare(),e=>e.code==='VCS_COMMAND'&&e.message.includes('not-an-object'));
  assert.equal(seen.pending.size,0);assert.ok(seen.commands.includes('check-attr'));
});

for(const kind of ['cancel','deadline'])test(kind+' drains all concurrent Git children before returning',async t=>{
  const f=await fixture(t),seen=track(),controller=new AbortController();let release,paired=false;
  observe=(args,child)=>{
    seen.observe(args,child);
    if(args[0]==='check-ref-format')release=holdClose(child);
    if(args[0]==='ls-tree'){
      paired=true;
      if(kind==='cancel')setImmediate(()=>controller.abort());
      // Keep one runner pending through cancellation/expiry; runner cleanup
      // must still join its close before capture can surface either error.
      setTimeout(()=>release?.(),kind==='deadline'?5500:80);
    }
  };
  t.after(()=>release?.());
  const work=()=>f.prepare({signal:controller.signal});
  await assert.rejects(kind==='deadline'?withOperationBudget({timeoutMs:5000},work):work(),{code:kind==='deadline'?'TIMEOUT':'ABORT_ERR'});
  assert.equal(paired,true);assert.equal(seen.pending.size,0);assert.ok(!seen.commands.includes('cat-file'));
});

for(const guard of ['filter','metadata'])test(guard+' guard refuses before parallel work',async t=>{
  const f=await fixture(t);
  if(guard==='filter')await f.run('config','filter.unsafe.clean','unsafe-command');
  else await fs.writeFile(path.join(f.root,'.git','MERGE_HEAD'),'unsupported');
  const seen=track();observe=seen.observe;
  await assert.rejects(f.prepare(),{code:'vcs/index-unsupported'});
  assert.deepEqual(seen.commands,guard==='filter'?['config']:[]);assert.equal(seen.pending.size,0);
});
