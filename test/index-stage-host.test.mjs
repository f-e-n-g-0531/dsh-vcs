import test from 'node:test';
import assert from 'node:assert/strict';
import {createIndexStageCoordinator} from '../index-stage-host.mjs';
import {createIndexUnstageCoordinator} from '../index-change-host.mjs';
import {createBranchSwitchCoordinator,acquireRepositoryAccess} from '../branch-switch-host.mjs';

const invalid={code:'vcs/index-confirmation-invalid'};
const unknown={code:'vcs/index-outcome-unknown'};
let rootId=0;
function fixture({api:overrides={},...config}={}){
 let now=100;
 const snapshot={path:'resolved/file.txt',head:{oid:'a'.repeat(40)},index:{oid:'b'.repeat(40),mode:'100644'},target:{oid:'c'.repeat(40),mode:'100755'},
  fingerprint:'private-fingerprint',rawBytes:Buffer.from('private-index-bytes'),metadataDigest:'private-digest',capturedBytes:Buffer.from('private-worktree-content')};
 const address={sessionId:'session',repositoryId:'repository',path:'host/resolved.txt'};
 const options={entry:{},repository:{root:'/index-host-test-'+ ++rootId,type:'git'},cwd:'/cwd',assertAuthorized:async()=>{}};
 const preparedCalls=[],appliedCalls=[];
 const api={
  async prepareIndexStage(repository,request){assert.equal(this,api);preparedCalls.push({repository,request});return snapshot;},
  async applyIndexStage(repository,request){assert.equal(this,api);appliedCalls.push({repository,request});request.onStart();return {ok:true};},
  ...overrides,
 };
 const host=createIndexStageCoordinator({api,now:()=>now,...config});
 return {host,snapshot,address,options,preparedCalls,appliedCalls,setNow:value=>{now=value;},
  prepare:(extra={},binding=options)=>host.prepare({...address,...extra},binding),
  confirm:(prepared,extra={},binding=options)=>host.confirm({...address,...extra,token:prepared.token},binding)};
}

test('prepare projects only stable summaries, preserves adapter head shape, and fixes action',async()=>{
 for(const head of [{oid:'a'.repeat(40)},'a'.repeat(40),null]){
  const f=fixture();f.snapshot.head=head;
  const signal=new AbortController().signal;
  const p=await f.prepare({action:'unstage',operationKind:'other',snapshot:{path:'untrusted'}},{...f.options,signal});
  assert.deepEqual(Object.keys(p).sort(),['action','expiresAt','head','index','path','target','token']);
  assert.deepEqual(p,{action:'stage',path:f.snapshot.path,head,index:f.snapshot.index,target:f.snapshot.target,token:p.token,expiresAt:60100});
  assert.match(p.token,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(p).includes('private-'),false);
  assert.equal(f.preparedCalls.length,1);
  assert.deepEqual(f.preparedCalls[0].request,{path:f.address.path,signal});
  assert.deepEqual(f.preparedCalls[0].repository,f.options.repository);
 }
});

test('confirm uses exact server-private snapshot and accepts no replacement path, action or snapshot',async()=>{
 const f=fixture(),p=await f.prepare(),signal=new AbortController().signal;
 assert.deepEqual(await f.confirm(p,{path:'replacement',action:'unstage',operationKind:'branch-switch',snapshot:{path:'replacement'}},{...f.options,signal}),{ok:true});
 assert.equal(f.preparedCalls.length,1);
 assert.equal(f.appliedCalls.length,1);
 const {repository,request}=f.appliedCalls[0];
 assert.deepEqual(repository,f.options.repository);
 assert.deepEqual(Object.keys(request).sort(),['assertAuthorized','onStart','signal','snapshot']);
 assert.equal(request.snapshot,f.snapshot);
 assert.equal(request.snapshot.rawBytes,f.snapshot.rawBytes);
 assert.equal(request.snapshot.capturedBytes,f.snapshot.capturedBytes);
 assert.deepEqual(request.snapshot.target,{oid:'c'.repeat(40),mode:'100755'});
 assert.equal(request.signal,signal);
 assert.equal(request.assertAuthorized,f.options.assertAuthorized);
 await assert.rejects(f.confirm(p),invalid);
 assert.equal(f.appliedCalls.length,1);
});

test('TTL expires exactly at boundary and maxTokens evicts oldest confirmation',async()=>{
 const f=fixture({ttlMs:10,maxTokens:2}),p=await f.prepare();
 assert.equal(p.expiresAt,110);
 f.setNow(109);await f.confirm(p);
 const q=await f.prepare();f.setNow(q.expiresAt);await assert.rejects(f.confirm(q),invalid);
 const tokens=[await f.prepare(),await f.prepare(),await f.prepare()];
 await assert.rejects(f.confirm(tokens[0]),invalid);
 await f.confirm(tokens[1]);await f.confirm(tokens[2]);
 assert.equal(f.appliedCalls.length,3);
});

test('Session, repository id, grant, repository identity and cwd are bound; mismatches burn token',async()=>{
 for(const change of [f=>({...f.options,entry:{}}),f=>({...f.options,repository:{...f.options.repository}}),f=>({...f.options,cwd:'/other'})]){
  const f=fixture(),p=await f.prepare();
  await assert.rejects(f.confirm(p,{},change(f)),invalid);
  await assert.rejects(f.confirm(p),invalid);assert.equal(f.appliedCalls.length,0);
 }
 for(const change of [{sessionId:'other'},{repositoryId:'other'}]){
  const f=fixture(),p=await f.prepare();
  await assert.rejects(f.confirm(p,change),invalid);
  await assert.rejects(f.confirm(p),invalid);assert.equal(f.appliedCalls.length,0);
 }
});

test('invalidate is grant-scoped and clear disposes outstanding confirmations',async()=>{
 const f=fixture(),otherEntry={},p=await f.prepare(),otherOptions={...f.options,entry:otherEntry};
 const q=await f.prepare({},otherOptions);
 f.host.invalidate(f.options.entry);
 await assert.rejects(f.confirm(p),invalid);
 await f.confirm(q,{},otherOptions);
 const r=await f.prepare();f.host.clear();await assert.rejects(f.confirm(r),invalid);
});

test('prepare rechecks authorization and abort; confirm rejects pre-start denial without executing',async()=>{
 const denied=Object.assign(Error('revoked'),{code:'denied'}),f=fixture();
 const unauthorized={...f.options,assertAuthorized:async()=>{throw denied;}};
 await assert.rejects(f.prepare({},unauthorized),error=>error===denied);
 const controller=new AbortController();controller.abort();
 await assert.rejects(f.prepare({},{...f.options,signal:controller.signal}),{name:'AbortError'});
 const p=await f.prepare();
 await assert.rejects(f.confirm(p,{},unauthorized),error=>error===denied);
 await assert.rejects(f.confirm(p),invalid);
 const q=await f.prepare();
 await assert.rejects(f.confirm(q,{},{...f.options,signal:controller.signal}),{name:'AbortError'});
 assert.equal(f.appliedCalls.length,0);
 acquireRepositoryAccess(f.options.repository.root,true)();
});

test('pre-start adapter failure stays specific; started failure, abort and revoked authorization are unknown',async()=>{
 const failure=Object.assign(Error('stale'),{code:'vcs/stale'});
 const pre=fixture({api:{applyIndexStage:async()=>{throw failure;}}}),p=await pre.prepare();
 await assert.rejects(pre.confirm(p),error=>error===failure);
 await assert.rejects(pre.confirm(p),invalid);
 for(const kind of ['throw','abort','authorization']){
  const controller=new AbortController();let checks=0;
  const f=fixture({api:{applyIndexStage:async(repository,request)=>{
   request.onStart();
   if(kind==='throw')throw failure;
   if(kind==='abort')controller.abort();
   return {ok:true};
  }}}),q=await f.prepare();
  await assert.rejects(f.confirm(q,{},{...f.options,signal:controller.signal,assertAuthorized:async()=>{
   if(++checks===2&&kind==='authorization')throw failure;
  }}),error=>{
   assert.equal(error.code,unknown.code);
   assert.match(error.message,/append-only object writes may remain/i);
   assert.match(error.message,/refresh.*inspect the index/i);
   assert.equal(error.message.includes('stale'),false);
   return true;
  });
  await assert.rejects(f.confirm(q),invalid);
  acquireRepositoryAccess(f.options.repository.root,true)();
 }
});

function peer(kind,execute){
 if(kind==='unstage')return createIndexUnstageCoordinator({api:{prepareIndexUnstage:async()=>({path:'peer.txt',head:'head',index:{oid:'index'},target:{oid:'head'}}),applyIndexUnstage:execute}});
 return createBranchSwitchCoordinator({api:{prepareLocalBranchSwitch:async()=>({current:'main',target:'next'}),switchLocalBranch:execute}});
}

test('stage tokens cannot cross unstage, branch or another stage instance in either direction',async()=>{
 for(const kind of ['unstage','branch','stage']){
  const f=fixture();let writes=0;
  const execute=async(repository,request)=>{writes++;request.onStart();return {ok:true};};
  const other=kind==='stage'?createIndexStageCoordinator({api:{prepareIndexStage:async()=>f.snapshot,applyIndexStage:execute}}):peer(kind,execute);
  const address={...f.address,branch:'next'},p=await f.prepare(),q=await other.prepare(address,f.options);
  // Identical authenticated binding: rejection must come from token ownership,
  // not incidental differences in session, grant, repository identity or cwd.
  await assert.rejects(other.confirm({...address,token:p.token,operationKind:'index-stage',action:'stage'},f.options),{code:kind==='branch'?'vcs/branch-confirmation-invalid':invalid.code});
  await assert.rejects(f.confirm(q,{operationKind:kind==='branch'?'branch-switch':'index-unstage',action:kind}),invalid);
  assert.equal(writes,0);assert.equal(f.appliedCalls.length,0);
  // A foreign-token attempt cannot consume the owner's valid token.
  await f.confirm(p);await other.confirm({...address,token:q.token},f.options);
  assert.equal(f.appliedCalls.length,1);assert.equal(writes,1);
  await assert.rejects(f.confirm(p),invalid);
  await assert.rejects(other.confirm({...address,token:q.token},f.options));
 }
});

test('stage shares the repository mutex with unstage and branch in both directions',async()=>{
 for(const kind of ['unstage','branch'])for(const stageFirst of [true,false]){
  let unlock,started;
  const gate=new Promise(resolve=>{unlock=resolve;}),began=new Promise(resolve=>{started=resolve;});
  const execute=async(repository,request)=>{request.onStart();started();await gate;return {ok:true};};
  const f=fixture({api:{applyIndexStage:execute}}),other=peer(kind,execute);
  const address={...f.address,branch:'next'},p=await f.prepare(),q=await other.prepare(address,f.options);
  const pending=stageFirst?f.confirm(p):other.confirm({...address,token:q.token},f.options);
  await began;
  try{
   assert.throws(()=>acquireRepositoryAccess(f.options.repository.root),{code:'vcs/busy'});
   assert.throws(()=>acquireRepositoryAccess(f.options.repository.root,true),{code:'vcs/busy'});
   await assert.rejects(stageFirst?other.confirm({...address,token:q.token},f.options):f.confirm(p),{code:'vcs/busy'});
  }finally{unlock();await pending;}
  acquireRepositoryAccess(f.options.repository.root,true)();
 }
});

test('an active reader prevents stage, consumes the token, and never starts the adapter',async()=>{
 const f=fixture(),p=await f.prepare(),release=acquireRepositoryAccess(f.options.repository.root);
 try{await assert.rejects(f.confirm(p),{code:'vcs/busy'});}finally{release();}
 assert.equal(f.appliedCalls.length,0);
 await assert.rejects(f.confirm(p),invalid);
});
