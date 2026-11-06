import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartialUnstageCoordinator} from '../partial-unstage-host.mjs';
import {createPartialStageCoordinator} from '../partial-stage-host.mjs';
import {createIndexStageCoordinator} from '../index-stage-host.mjs';
import {createIndexUnstageCoordinator} from '../index-change-host.mjs';
import {acquireRepositoryAccess} from '../confirmed-operation.mjs';

const invalid={code:'vcs/index-confirmation-invalid'};
let serial=0;
function fixture({api:overrides={},...config}={}){
 let time=100;
 const snapshot={path:'file.txt',head:null,index:{oid:'index',mode:'100644'},plan:Object.freeze({id:'plan-id',units:Object.freeze([{id:'one'},{id:'two'}])}),fingerprint:'private',bytes:Buffer.from('private')};
 const selected={path:snapshot.path,head:snapshot.head,index:snapshot.index,target:{oid:'candidate',mode:'100644'},planId:snapshot.plan.id,unitIds:Object.freeze(['one']),bytes:Buffer.from('private-selected')};
 const address={sessionId:'session',repositoryId:'repo',id:'opaque-id'};
 const binding={entry:{},repository:{root:'/partial-host-'+ ++serial,type:'git'},cwd:'/cwd',assertAuthorized:async()=>{}};
 const calls={plan:[],select:[],apply:[]};
 const api={
  async preparePartialIndexUnstage(repo,request){assert.equal(this,api);calls.plan.push({repo,request});return snapshot;},
  async selectPartialIndexUnstage(repo,request){assert.equal(this,api);calls.select.push({repo,request});return selected;},
  async applyPartialIndexUnstage(repo,request){assert.equal(this,api);calls.apply.push({repo,request});request.onStart();return {ok:true};},
  ...overrides,
 };
 const host=createPartialUnstageCoordinator({api,now:()=>time,...config});
 return {host,api,address,binding,snapshot,selected,calls,setNow:v=>{time=v;},
  plan:(extra={},b=binding)=>host.plan({...address,...extra},b),
  prepare:(p,extra={},b=binding)=>host.prepare({...address,planToken:p.planToken,unitIds:['one'],...extra},b),
  confirm:(p,extra={},b=binding)=>host.confirm({...address,token:p.token,...extra},b)};
}

test('plan, prepare, confirm project only safe fields and never write before confirmation',async()=>{
 const f=fixture(),signal=new AbortController().signal,b={...f.binding,signal};
 const p=await f.plan({action:'evil',path:'untrusted'},b);
 assert.deepEqual(p,{action:'partial-unstage',path:f.snapshot.path,head:null,index:f.snapshot.index,plan:f.snapshot.plan,planToken:p.planToken,expiresAt:60100});
 assert.match(p.planToken,/^[a-f0-9]{64}$/);
 assert.deepEqual(f.calls.plan[0],{repo:f.binding.repository,request:{id:f.address.id,signal}});
 assert.equal(f.calls.apply.length,0);
 const q=await f.prepare(p,{operationKind:'index-stage',snapshot:{}},b);
 assert.deepEqual(q,{action:'partial-unstage',path:f.selected.path,head:null,index:f.selected.index,target:f.selected.target,planId:'plan-id',unitIds:['one'],token:q.token,expiresAt:60100});
 assert.match(q.token,/^[a-f0-9]{64}$/);assert.notEqual(q.token,p.planToken);
 assert.equal(JSON.stringify([p,q]).includes('private'),false);
 assert.equal(f.calls.select[0].request.snapshot,f.snapshot);
 assert.equal(f.calls.select[0].request.signal,signal);
 assert.equal(f.calls.apply.length,0);
 q.unitIds[0]='two';
 assert.deepEqual(await f.confirm(q,{path:'evil',snapshot:{},action:'unstage'},b),{ok:true});
 const {repo,request}=f.calls.apply[0];
 assert.deepEqual(repo,f.binding.repository);assert.equal(request.snapshot,f.selected);
 assert.deepEqual(request.snapshot.unitIds,['one']);assert.equal(request.assertAuthorized,b.assertAuthorized);
 assert.equal(request.signal,signal);assert.equal(typeof request.onStart,'function');
 await assert.rejects(f.prepare(p),invalid);await assert.rejects(f.confirm(q),invalid);
});

test('both token stores enforce exact TTL, finite bounds, and oldest-first capacity',async()=>{
 for(const options of [{ttlMs:0},{ttlMs:Infinity},{maxTokens:0},{maxTokens:1.5}])assert.throws(()=>fixture(options),TypeError);
 const f=fixture({ttlMs:10,maxTokens:2}),p=await f.plan();
 f.setNow(109);const q=await f.prepare(p);assert.equal(q.expiresAt,119);
 f.setNow(119);await assert.rejects(f.confirm(q),invalid);
 const expired=await f.plan();f.setNow(expired.expiresAt);await assert.rejects(f.prepare(expired),invalid);
 const plans=[await f.plan(),await f.plan(),await f.plan()];await assert.rejects(f.prepare(plans[0]),invalid);
 const a=await f.prepare(plans[1]),b=await f.prepare(plans[2]),c=await f.prepare(await f.plan());
 await assert.rejects(f.confirm(a),invalid);await f.confirm(b);await f.confirm(c);
});

test('both phases bind exact grant/repository objects, session/repository IDs and cwd; mismatch burns',async()=>{
 for(const phase of ['plan','confirm'])for(const change of [
  f=>[{}, {...f.binding,entry:{}}],f=>[{}, {...f.binding,repository:{...f.binding.repository}}],
  f=>[{}, {...f.binding,cwd:'/other'}],f=>[{sessionId:'other'},f.binding],f=>[{repositoryId:'other'},f.binding],
 ]){
  const f=fixture(),p=await f.plan(),q=phase==='confirm'?await f.prepare(p):p,[extra,b]=change(f);
  const attempt=()=>phase==='confirm'?f.confirm(q,extra,b):f.prepare(q,extra,b);
  await assert.rejects(attempt(),invalid);
  await assert.rejects(phase==='confirm'?f.confirm(q):f.prepare(q),invalid);
  assert.equal(f.calls.apply.length,0);if(phase==='plan')assert.equal(f.calls.select.length,0);
 }
});

test('invalid IDs and failed selection consume plans before any selection attempt can be replayed',async()=>{
 for(const ids of [undefined,[],[1],Array(1),['one','two','three'],Object.defineProperty([],0,{get(){throw Error('getter invoked');}})]){
  const f=fixture(),p=await f.plan();await assert.rejects(f.prepare(p,{unitIds:ids}),invalid);
  await assert.rejects(f.prepare(p),invalid);assert.equal(f.calls.select.length,0);
 }
 const failure=Object.assign(Error('invalid selection'),{code:'vcs/index-invalid'});
 const f=fixture({api:{async selectPartialIndexUnstage(){throw failure;}}}),p=await f.plan();
 await assert.rejects(f.prepare(p),e=>e===failure);await assert.rejects(f.prepare(p),invalid);
});

test('IDs and authenticated binding are captured before the first await',async()=>{
 let resolve;const gate=new Promise(r=>{resolve=r;});let received;
 const f=fixture({api:{async selectPartialIndexUnstage(repo,request){received=request;await gate;return {...f.selected,unitIds:request.unitIds};}}});
 const p=await f.plan(),ids=['one'],address={...f.address,planToken:p.planToken,unitIds:ids},binding={...f.binding};
 const pending=f.host.prepare(address,binding);
 ids[0]='two';address.sessionId='other';binding.cwd='/other';
 assert.equal(Object.isFrozen(received.unitIds),true);assert.deepEqual(received.unitIds,['one']);
 await assert.rejects(f.prepare(p),invalid);resolve();const q=await pending;
 assert.deepEqual(q.unitIds,['one']);await f.confirm(q);
});

test('invalidate is grant-scoped; clear removes both plan and confirmation grants',async()=>{
 for(const mode of ['invalidate','clear']){
  const f=fixture(),other={...f.binding,entry:{}},p=await f.plan(),q=await f.prepare(await f.plan()),r=await f.plan({},other),s=await f.prepare(await f.plan({},other),{},other);
  if(mode==='clear')f.host.clear();else f.host.invalidate(f.binding.entry);
  await assert.rejects(f.prepare(p),invalid);await assert.rejects(f.confirm(q),invalid);
  if(mode==='clear'){await assert.rejects(f.prepare(r,{},other),invalid);await assert.rejects(f.confirm(s,{},other),invalid);}
  else{await f.confirm(await f.prepare(r,{},other),{},other);await f.confirm(s,{},other);}
 }
});

test('plan and selection post-check authorization and cancellation before minting',async()=>{
 const denied=Object.assign(Error('denied'),{code:'denied'});
 for(const phase of ['plan','select'])for(const kind of ['abort','denial']){
  const controller=new AbortController(),f=fixture(),p=phase==='select'?await f.plan():null;
  const binding={...f.binding,signal:controller.signal,assertAuthorized:async()=>{if(kind==='abort')controller.abort();else throw denied;}};
  await assert.rejects(phase==='plan'?f.plan({},binding):f.prepare(p,{},binding),kind==='abort'?{name:'AbortError'}:e=>e===denied);
  assert.equal(f.calls.apply.length,0);if(p)await assert.rejects(f.prepare(p),invalid);
 }
});

test('plan tokens cannot confirm and stage/unstage/foreign-partial tokens remain isolated',async()=>{
 const f=fixture(),p=await f.plan();await assert.rejects(f.confirm({token:p.planToken}),invalid);
 const q=await f.prepare(p);
 for(const kind of ['stage','unstage','partial']){
  let writes=0;const execute=async(repo,request)=>{writes++;request.onStart();return {ok:true};};
  const other=kind==='stage'?createIndexStageCoordinator({api:{prepareIndexStage:async()=>f.selected,applyIndexStage:execute}}):kind==='unstage'?createIndexUnstageCoordinator({api:{prepareIndexUnstage:async()=>f.selected,applyIndexUnstage:execute}}):createPartialUnstageCoordinator({api:{preparePartialIndexUnstage:async()=>f.snapshot,selectPartialIndexUnstage:async()=>f.selected,applyPartialIndexUnstage:execute}});
  const r=kind==='partial'?await other.prepare({...f.address,planToken:(await other.plan(f.address,f.binding)).planToken,unitIds:['one']},f.binding):await other.prepare(f.address,f.binding);
  await assert.rejects(other.confirm({...f.address,token:q.token,operationKind:kind},f.binding),invalid);
  await assert.rejects(f.confirm(r),invalid);assert.equal(writes,0);
  await other.confirm({...f.address,token:r.token},f.binding);assert.equal(writes,1);
 }
 await f.confirm(q);
});

test('pre-start errors stay specific; started failures, cancellation and authorization loss are append-only unknown',async()=>{
 const failure=Object.assign(Error('private stale'),{code:'vcs/index-stale'});
 for(const kind of ['pre','throw','abort','denial']){
  const controller=new AbortController();let checks=0;
  const f=fixture({api:{async applyPartialIndexUnstage(repo,request){if(kind==='pre')throw failure;request.onStart();if(kind==='throw')throw failure;if(kind==='abort')controller.abort();return {ok:true};}}});
  const q=await f.prepare(await f.plan()),binding={...f.binding,signal:controller.signal,assertAuthorized:async()=>{if(++checks===2&&kind==='denial')throw failure;}};
  await assert.rejects(f.confirm(q,{},binding),e=>{
   if(kind==='pre')return e===failure;
   assert.equal(e.code,'vcs/index-outcome-unknown');assert.match(e.message,/append-only object writes may remain/i);assert.match(e.message,/refresh.*inspect the index/i);assert.doesNotMatch(e.message,/private/);return true;
  });
  await assert.rejects(f.confirm(q),invalid);acquireRepositoryAccess(f.binding.repository.root,true)();
 }
});

test('confirm shares stage/unstage repository mutex both ways; read phases acquire no internal locks',async()=>{
 for(const kind of ['stage','unstage','partial-stage'])for(const partialFirst of [true,false]){
  let unlock,started;const gate=new Promise(r=>{unlock=r;}),began=new Promise(r=>{started=r;});
  const execute=async(repo,request)=>{request.onStart();started();await gate;return {ok:true};};
  const f=fixture({api:{applyPartialIndexUnstage:execute}}),other=kind==='stage'?createIndexStageCoordinator({api:{prepareIndexStage:async()=>f.selected,applyIndexStage:execute}}):kind==='unstage'?createIndexUnstageCoordinator({api:{prepareIndexUnstage:async()=>f.selected,applyIndexUnstage:execute}}):createPartialStageCoordinator({api:{preparePartialIndexStage:async()=>f.snapshot,selectPartialIndexStage:async()=>f.selected,applyIndexStage:execute}});
  const p=await f.prepare(await f.plan()),q=kind==='partial-stage'?await other.prepare({...f.address,planToken:(await other.plan(f.address,f.binding)).planToken,unitIds:['one']},f.binding):await other.prepare(f.address,f.binding);
  const pending=partialFirst?f.confirm(p):other.confirm({...f.address,token:q.token},f.binding);await began;
  try{
   assert.throws(()=>acquireRepositoryAccess(f.binding.repository.root),{code:'vcs/busy'});
   await assert.rejects(partialFirst?other.confirm({...f.address,token:q.token},f.binding):f.confirm(p),{code:'vcs/busy'});
   // Host owns read locking, so these fake read adapters are not blocked here.
   await f.prepare(await f.plan());
  }finally{unlock();await pending;}
  acquireRepositoryAccess(f.binding.repository.root,true)();
 }
 const f=fixture(),q=await f.prepare(await f.plan()),release=acquireRepositoryAccess(f.binding.repository.root);
 try{await assert.rejects(f.confirm(q),{code:'vcs/busy'});}finally{release();}
 await assert.rejects(f.confirm(q),invalid);assert.equal(f.calls.apply.length,0);
});

test('partial stage and unstage plans and confirmations are bidirectionally isolated with identical bindings',async()=>{
 const f=fixture();let selections=0,writes=0;
 const stage=createPartialStageCoordinator({api:{
  preparePartialIndexStage:async()=>f.snapshot,
  selectPartialIndexStage:async()=>{selections++;return f.selected;},
  applyIndexStage:async(repo,request)=>{writes++;request.onStart();return {ok:true};},
 }});
 const p=await f.plan(),s=await stage.plan(f.address,f.binding);
 const selection=planToken=>({...f.address,planToken,unitIds:['one'],operationKind:'partial-index-stage'});
 await assert.rejects(stage.prepare(selection(p.planToken),f.binding),invalid);
 await assert.rejects(f.prepare(s,{operationKind:'partial-index-unstage'}),invalid);
 assert.equal(selections,0);assert.equal(f.calls.select.length,0);
 const q=await f.prepare(p),r=await stage.prepare(selection(s.planToken),f.binding);
 await assert.rejects(stage.prepare(selection(q.token),f.binding),invalid);
 await assert.rejects(f.prepare({planToken:r.token}),invalid);
 await assert.rejects(stage.confirm({...f.address,token:q.token,operationKind:'partial-index-stage'},f.binding),invalid);
 await assert.rejects(f.confirm(r,{operationKind:'partial-index-unstage'}),invalid);
 assert.equal(writes,0);assert.equal(f.calls.apply.length,0);
 await f.confirm(q);await stage.confirm({...f.address,token:r.token},f.binding);
 assert.equal(writes,1);assert.equal(f.calls.apply.length,1);
});

test('partial stage and unstage invalidation and clearing do not affect each other',async()=>{
 for(const unstageFirst of [true,false])for(const mode of ['invalidate','clear']){
  const f=fixture(),stage=createPartialStageCoordinator({api:{preparePartialIndexStage:async()=>f.snapshot,selectPartialIndexStage:async()=>f.selected,applyIndexStage:async(repo,request)=>{request.onStart();return {ok:true};}}});
  const keep=unstageFirst?stage:f.host,drop=unstageFirst?f.host:stage;
  const selection=planToken=>({...f.address,planToken,unitIds:['one']});
  const kp=await keep.plan(f.address,f.binding),kq=await keep.prepare(selection((await keep.plan(f.address,f.binding)).planToken),f.binding);
  const dp=await drop.plan(f.address,f.binding),dq=await drop.prepare(selection((await drop.plan(f.address,f.binding)).planToken),f.binding);
  if(mode==='clear')drop.clear();else drop.invalidate(f.binding.entry);
  await assert.rejects(drop.prepare(selection(dp.planToken),f.binding),invalid);
  await assert.rejects(drop.confirm({...f.address,token:dq.token},f.binding),invalid);
  await keep.confirm({...f.address,token:kq.token},f.binding);
  const q=await keep.prepare(selection(kp.planToken),f.binding);await keep.confirm({...f.address,token:q.token},f.binding);
 }
});

test('confirmation pre-start cancellation and authorization loss burn tokens without execution',async()=>{
 for(const kind of ['abort','denial']){
  const f=fixture(),q=await f.prepare(await f.plan()),controller=new AbortController(),denied=Error('denied');
  if(kind==='abort')controller.abort();
  const binding={...f.binding,signal:controller.signal,assertAuthorized:async()=>{if(kind==='denial')throw denied;}};
  await assert.rejects(f.confirm(q,{},binding),kind==='abort'?{name:'AbortError'}:e=>e===denied);
  assert.equal(f.calls.apply.length,0);await assert.rejects(f.confirm(q),invalid);
  acquireRepositoryAccess(f.binding.repository.root,true)();
 }
});
