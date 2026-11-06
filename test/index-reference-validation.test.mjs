import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs/promises';
import * as sync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {git} from '../local-command.mjs';
import {prepareIndexStage,applyIndexStage,prepareIndexUnstage,applyIndexUnstage} from '../index-change.mjs';
import {withOperationBudget,currentOperationBudget} from '../src/operation-budget.mjs';

// Observe actual commands/output, without mocking validation or public adapters.
const originalSpawn=cp.spawn,originalLstat=fs.lstat;
let observe,open;
cp.spawn=(command,args,options)=>{
  const child=originalSpawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-reference-absent-global')}});
  if(command==='git')observe?.(args.slice(4),child);
  return child;
};
fs.lstat=async(...args)=>{await open?.(args[0]);return originalLstat(...args);};
syncBuiltinESMExports();
test.after(()=>{cp.spawn=originalSpawn;fs.lstat=originalLstat;syncBuiltinESMExports();});
test.afterEach(()=>{observe=open=undefined;});
async function fixture(t,action='stage'){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-reference-validation-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
  const run=(...args)=>git(root,args);
  await run('init');
  for(const [key,value] of [['user.name','Ref Test'],['user.email','ref@example.invalid'],['core.autocrlf','false'],['core.safecrlf','false'],['commit.gpgsign','false']])await run('config',key,value);
  await fs.writeFile(path.join(root,'selected'),'base\n');await run('add','.');await run('commit','-m','base');
  await run('branch','alternate');
  await fs.writeFile(path.join(root,'selected'),'changed\n');if(action==='unstage')await run('add','selected');
  const repo={type:'git',root},head=path.join(root,'.git','HEAD'),index=()=>fs.readFile(path.join(root,'.git','index'));
  return {root,head,index,run,prepare:options=>(action==='stage'?prepareIndexStage:prepareIndexUnstage)(repo,{path:'selected',...options}),apply:(snapshot,options)=>(action==='stage'?applyIndexStage:applyIndexUnstage)(repo,{snapshot,assertAuthorized:()=>{},onStart:()=>{},...options})};
}
function track(){
  const commands=[],pending=new Set();
  return {commands,pending,count:name=>commands.filter(a=>a[0]===name).length,observe(args,child){commands.push(args);pending.add(child);child.once('close',()=>pending.delete(child));}};
}
for(const action of ['stage','unstage'])test(action+' each public prepare/apply validates unchanged ref once, never across calls',async t=>{
  const f=await fixture(t,action);
  for(let i=0;i<2;i++){
    const seen=track();observe=seen.observe;await f.prepare();
    assert.equal(seen.count('check-ref-format'),1);assert.equal(seen.count('config'),2);
    assert.equal(seen.count('rev-parse'),2);assert.equal(seen.count('check-attr'),2);assert.equal(seen.pending.size,0);
  }
  observe=undefined;const snapshot=await f.prepare(),seen=track();observe=seen.observe;
  await f.apply(snapshot);
  const captures=seen.count('config');assert.ok(captures>2);
  assert.equal(seen.count('check-ref-format'),1);assert.equal(seen.count('rev-parse'),captures);assert.equal(seen.count('check-attr'),captures);assert.equal(seen.pending.size,0);
  t.diagnostic(JSON.stringify({action,captures,refChecks:1,commands:seen.commands.length}));
});
for(const action of ['stage','unstage'])test(action+' changed valid ref reruns checker and full fingerprint stays stale',async t=>{
  const f=await fixture(t,action),before=await f.index(),seen=track();let changed=false;
  observe=(args,child)=>{seen.observe(args,child);if(args[0]==='check-attr'&&!changed){changed=true;child.prependOnceListener('close',()=>sync.writeFileSync(f.head,'ref: refs/heads/alternate\n'));}};
  await assert.rejects(f.prepare(),{code:'vcs/index-stale'});
  assert.equal(seen.count('check-ref-format'),2);
  assert.equal(seen.commands.filter(a=>a[0]==='check-ref-format')[1][1],'refs/heads/alternate');
  assert.deepEqual(await f.index(),before);assert.equal(seen.pending.size,0);
});
test('invalid reread HEAD name invokes real checker and drains tree sibling',async t=>{
  const f=await fixture(t),before=await f.index(),seen=track();let factsDone,release;
  const factsClosed=new Promise(resolve=>{factsDone=resolve;});
  observe=(args,child)=>{seen.observe(args,child);if(args[0]==='rev-parse'){child.once('close',factsDone);open=async file=>{if(file===f.head){open=undefined;await factsClosed;await fs.writeFile(f.head,'ref: refs/heads/invalid..name\n');}};}if(args[0]==='ls-tree') {
    const emit=child.emit;child.emit=function(event,...rest){if(event==='close'){release=()=>emit.call(this,event,...rest);setTimeout(release,40);return true;}return emit.call(this,event,...rest);};
  }};
  // Facts resolve against real original HEAD; the independent plain HEAD read sees
  // an invalid exact name. No command output is fabricated to reach the checker.
  await assert.rejects(f.prepare(),{code:'VCS_COMMAND'});
  assert.equal(seen.count('check-ref-format'),1);assert.equal(seen.count('ls-tree'),1);
  assert.equal(seen.pending.size,0);assert.deepEqual(await f.index(),before);
  open=undefined;observe=undefined;await fs.writeFile(f.head,'ref: refs/heads/alternate\n');
  const retry=track();observe=retry.observe;await f.prepare();assert.equal(retry.count('check-ref-format'),1);
});
for(const action of ['stage','unstage'])for(const name of ['alternate','invalid..name'])test(action+' authorization changes HEAD to '+name+' after warmup still refuses',async t=>{
  const f=await fixture(t,action),snapshot=await f.prepare(),before=await f.index(),seen=track();let calls=0,started=false;
  observe=seen.observe;
  await assert.rejects(f.apply(snapshot,{onStart:()=>{started=true;},assertAuthorized:async()=>{if(++calls===2)await fs.writeFile(f.head,'ref: refs/heads/'+name+'\n');}}));
  assert.equal(started,false);assert.deepEqual(await f.index(),before);assert.equal(seen.pending.size,0);
  assert.equal(seen.count('check-ref-format'),name==='alternate'?2:1);
});
for(const action of ['stage','unstage'])for(const kind of ['cancel','deadline'])test(action+' warm ref cache respects '+kind+' before mutation',async t=>{
  const f=await fixture(t,action),snapshot=await f.prepare(),before=await f.index(),controller=new AbortController(),seen=track();let calls=0,started=false;
  observe=seen.observe;
  const work=()=>f.apply(snapshot,{signal:controller.signal,onStart:()=>{started=true;},assertAuthorized:()=>{
    if(++calls!==2)return;
    if(kind==='cancel')controller.abort();else currentOperationBudget().throwIfExpired=()=>{throw Object.assign(Error('expired warm ref cache'),{code:'TIMEOUT'});};
  }});
  await assert.rejects(kind==='deadline'?withOperationBudget({timeoutMs:15000},work):work(),kind==='deadline'?{code:'TIMEOUT'}:{name:'AbortError'});
  assert.equal(seen.count('check-ref-format'),1);assert.equal(started,false);assert.equal(seen.pending.size,0);assert.deepEqual(await f.index(),before);
});
