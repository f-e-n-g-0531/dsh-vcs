import test from 'node:test';
import assert from 'node:assert/strict';
import {createLineStageCoordinator,createLineUnstageCoordinator} from '../line-index-host.mjs';
import {createPartialStageCoordinator} from '../partial-stage-host.mjs';
import {createPartialUnstageCoordinator} from '../partial-unstage-host.mjs';
import {createIndexStageCoordinator} from '../index-stage-host.mjs';
import {createIndexUnstageCoordinator} from '../index-change-host.mjs';
import {acquireRepositoryAccess} from '../confirmed-operation.mjs';

let serial=0;
for(const direction of ['stage','unstage']){
const suffix=direction==='stage'?'Stage':'Unstage';
const invalid={code:'vcs/index-confirmation-invalid'};

function fixture({api:overrides={},...config}={}){
 let time=100;
 const snapshot={path:'file.txt',head:null,index:{oid:'index',mode:'100644'},plan:Object.freeze({id:'plan-id',operations:Object.freeze([{id:'one'},{id:'two'}])}),fingerprint:'private',bytes:Buffer.from('private')};
 const selected={path:snapshot.path,head:snapshot.head,index:snapshot.index,target:{oid:'candidate',mode:'100644'},planId:snapshot.plan.id,operationIds:Object.freeze(['one']),bytes:Buffer.from('private-selected')};
 const address={sessionId:'session',repositoryId:'repo',id:'opaque-id'};
 const binding={entry:{},repository:{root:'/line-host-'+ ++serial,type:'git'},cwd:'/cwd',assertAuthorized:async()=>{}};
 const calls={plan:[],select:[],apply:[]};
 const api={
  async ['prepareLineIndex'+suffix](repo,request){assert.equal(this,api);calls.plan.push({repo,request});return snapshot;},
  async ['selectLineIndex'+suffix](repo,request){assert.equal(this,api);calls.select.push({repo,request});return selected;},
  async ['applyLineIndex'+suffix](repo,request){assert.equal(this,api);calls.apply.push({repo,request});request.onStart();return {ok:true};},
  ...overrides,
 };
 const host=(direction==='stage'?createLineStageCoordinator:createLineUnstageCoordinator)({api,now:()=>time,...config});
 return {host,api,address,binding,snapshot,selected,calls,setNow:v=>{time=v;},
  plan:(extra={},b=binding)=>host.plan({...address,...extra},b),
  prepare:(p,extra={},b=binding)=>host.prepare({...address,planToken:p.planToken,operationIds:['one'],...extra},b),
  confirm:(p,extra={},b=binding)=>host.confirm({...address,token:p.token,...extra},b)};
}

test(direction+': plan, prepare, confirm project only safe fields and never write before confirmation',async()=>{
 const f=fixture(),signal=new AbortController().signal,b={...f.binding,signal};
 const p=await f.plan({action:'evil',path:'untrusted'},b);
 assert.deepEqual(p,{action:'line-'+direction,path:f.snapshot.path,head:null,index:f.snapshot.index,plan:f.snapshot.plan,planToken:p.planToken,expiresAt:60100});
 assert.match(p.planToken,/^[a-f0-9]{64}$/);
 assert.deepEqual(f.calls.plan[0],{repo:f.binding.repository,request:{id:f.address.id,signal}});
 assert.equal(f.calls.apply.length,0);
 const q=await f.prepare(p,{operationKind:'index-stage',snapshot:{}},b);
 assert.deepEqual(q,{action:'line-'+direction,path:f.selected.path,head:null,index:f.selected.index,target:f.selected.target,planId:'plan-id',operationIds:['one'],token:q.token,expiresAt:60100});
 assert.match(q.token,/^[a-f0-9]{64}$/);assert.notEqual(q.token,p.planToken);
 assert.equal(JSON.stringify([p,q]).includes('private'),false);
 assert.equal(f.calls.select[0].request.snapshot,f.snapshot);
 assert.equal(f.calls.select[0].request.signal,signal);
 assert.equal(f.calls.apply.length,0);
 q.operationIds[0]='two';
 assert.deepEqual(await f.confirm(q,{path:'evil',snapshot:{},action:'unstage'},b),{ok:true});
 const {repo,request}=f.calls.apply[0];
 assert.deepEqual(repo,f.binding.repository);assert.equal(request.snapshot,f.selected);
 assert.deepEqual(request.snapshot.operationIds,['one']);assert.equal(request.assertAuthorized,b.assertAuthorized);
 assert.equal(request.signal,signal);assert.equal(typeof request.onStart,'function');
 await assert.rejects(f.prepare(p),invalid);await assert.rejects(f.confirm(q),invalid);
});

test(direction+': both token stores enforce exact TTL, finite bounds, and oldest-first capacity',async()=>{
 for(const options of [{ttlMs:0},{ttlMs:Infinity},{maxTokens:0},{maxTokens:1.5}])assert.throws(()=>fixture(options),TypeError);
 const f=fixture({ttlMs:10,maxTokens:2}),p=await f.plan();
 f.setNow(109);const q=await f.prepare(p);assert.equal(q.expiresAt,119);
 f.setNow(119);await assert.rejects(f.confirm(q),invalid);
 const expired=await f.plan();f.setNow(expired.expiresAt);await assert.rejects(f.prepare(expired),invalid);
 const plans=[await f.plan(),await f.plan(),await f.plan()];await assert.rejects(f.prepare(plans[0]),invalid);
 const a=await f.prepare(plans[1]),b=await f.prepare(plans[2]),c=await f.prepare(await f.plan());
 await assert.rejects(f.confirm(a),invalid);await f.confirm(b);await f.confirm(c);
});

test(direction+': both phases bind exact grant/repository objects, session/repository IDs and cwd; mismatch burns',async()=>{
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

test(direction+': invalid IDs and failed selection consume plans before any selection attempt can be replayed',async()=>{
 for(const ids of [undefined,[],[1],Array(1),['one','two','three'],['one','one'],['unknown'],Object.assign(['one'],{extra:true}),Object.assign(['one'],{[Symbol('extra')]:true}),Object.setPrototypeOf(['one'],null),Object.defineProperty(['one'],0,{enumerable:false}),Object.defineProperty([],0,{get(){throw Error('getter invoked');}})]){
  const f=fixture(),p=await f.plan();await assert.rejects(f.prepare(p,{operationIds:ids}),invalid);
  await assert.rejects(f.prepare(p),invalid);assert.equal(f.calls.select.length,0);
 }
 const failure=Object.assign(Error('invalid selection'),{code:'vcs/index-invalid'});
 const f=fixture({api:{async ['selectLineIndex'+suffix](){throw failure;}}}),p=await f.plan();
 await assert.rejects(f.prepare(p),e=>e===failure);await assert.rejects(f.prepare(p),invalid);
});

test(direction+': IDs and authenticated binding are captured before the first await',async()=>{
 let resolve;const gate=new Promise(r=>{resolve=r;});let received;
 const f=fixture({api:{async ['selectLineIndex'+suffix](repo,request){received=request;await gate;return {...f.selected,operationIds:request.operationIds};}}});
 const p=await f.plan(),ids=['one'],address={...f.address,planToken:p.planToken,operationIds:ids},binding={...f.binding};
 const pending=f.host.prepare(address,binding);
 ids[0]='two';address.sessionId='other';binding.cwd='/other';
 assert.equal(Object.isFrozen(received.operationIds),true);assert.deepEqual(received.operationIds,['one']);
 await assert.rejects(f.prepare(p),invalid);resolve();const q=await pending;
 assert.deepEqual(q.operationIds,['one']);await f.confirm(q);
});

test(direction+': invalidate is grant-scoped; clear removes both plan and confirmation grants',async()=>{
 for(const mode of ['invalidate','clear']){
  const f=fixture(),other={...f.binding,entry:{}},p=await f.plan(),q=await f.prepare(await f.plan()),r=await f.plan({},other),s=await f.prepare(await f.plan({},other),{},other);
  if(mode==='clear')f.host.clear();else f.host.invalidate(f.binding.entry);
  await assert.rejects(f.prepare(p),invalid);await assert.rejects(f.confirm(q),invalid);
  if(mode==='clear'){await assert.rejects(f.prepare(r,{},other),invalid);await assert.rejects(f.confirm(s,{},other),invalid);}
  else{await f.confirm(await f.prepare(r,{},other),{},other);await f.confirm(s,{},other);}
 }
});

test(direction+': plan and selection post-check authorization and cancellation before minting',async()=>{
 const denied=Object.assign(Error('denied'),{code:'denied'});
 for(const phase of ['plan','select'])for(const kind of ['abort','denial']){
  const controller=new AbortController(),f=fixture(),p=phase==='select'?await f.plan():null;
  const binding={...f.binding,signal:controller.signal,assertAuthorized:async()=>{if(kind==='abort')controller.abort();else throw denied;}};
  await assert.rejects(phase==='plan'?f.plan({},binding):f.prepare(p,{},binding),kind==='abort'?{name:'AbortError'}:e=>e===denied);
  assert.equal(f.calls.apply.length,0);if(p)await assert.rejects(f.prepare(p),invalid);
 }
});

test(direction+': pre-start errors stay specific; started failures, cancellation and authorization loss are append-only unknown',async()=>{
 const failure=Object.assign(Error('private stale'),{code:'vcs/index-stale'});
 for(const kind of ['pre','throw','abort','denial']){
  const controller=new AbortController();let checks=0;
  const f=fixture({api:{async ['applyLineIndex'+suffix](repo,request){if(kind==='pre')throw failure;request.onStart();if(kind==='throw')throw failure;if(kind==='abort')controller.abort();return {ok:true};}}});
  const q=await f.prepare(await f.plan()),binding={...f.binding,signal:controller.signal,assertAuthorized:async()=>{if(++checks===2&&kind==='denial')throw failure;}};
  await assert.rejects(f.confirm(q,{},binding),e=>{
   if(kind==='pre')return e===failure;
   assert.equal(e.code,'vcs/index-outcome-unknown');assert.match(e.message,/append-only object writes may remain/i);assert.match(e.message,/refresh.*inspect the index/i);assert.doesNotMatch(e.message,/private/);return true;
  });
  await assert.rejects(f.confirm(q),invalid);acquireRepositoryAccess(f.binding.repository.root,true)();
 }
});

// Same bindings and deliberately identical fake snapshots ensure isolation is
// provided by server-owned stores, not by repository or model differences.
function peers(f,execute){
 const api={
  prepareLineIndexStage:async()=>f.snapshot,prepareLineIndexUnstage:async()=>f.snapshot,
  selectLineIndexStage:async()=>f.selected,selectLineIndexUnstage:async()=>f.selected,
  applyLineIndexStage:execute,applyLineIndexUnstage:execute,
  preparePartialIndexStage:async()=>({...f.snapshot,plan:{id:'block',units:[{id:'one'}]}}),
  preparePartialIndexUnstage:async()=>({...f.snapshot,plan:{id:'block',units:[{id:'one'}]}}),
  selectPartialIndexStage:async()=>({...f.selected,unitIds:['one']}),selectPartialIndexUnstage:async()=>({...f.selected,unitIds:['one']}),
  prepareIndexStage:async()=>f.selected,prepareIndexUnstage:async()=>f.selected,
  applyIndexStage:execute,applyPartialIndexUnstage:execute,applyIndexUnstage:execute,
 };
 return [
  ['line-stage',createLineStageCoordinator({api})],['line-unstage',createLineUnstageCoordinator({api})],
  ['block-stage',createPartialStageCoordinator({api})],['block-unstage',createPartialUnstageCoordinator({api})],
  ['whole-stage',createIndexStageCoordinator({api})],['whole-unstage',createIndexUnstageCoordinator({api})],
 ];
}
async function peerPreview(kind,host,f){
 if(kind.startsWith('whole'))return host.prepare(f.address,f.binding);
 const p=await host.plan(f.address,f.binding);
 return host.prepare({...f.address,planToken:p.planToken,operationIds:['one'],unitIds:['one']},f.binding);
}

test(direction+': LINE/BLOCK/WHOLE and direction tokens are isolated bidirectionally with identical bindings',async()=>{
 const f=fixture(),p=await f.plan(),q=await f.prepare(await f.plan());let writes=0;
 await assert.rejects(f.confirm({token:p.planToken}),invalid);
 await assert.rejects(f.prepare({planToken:q.token}),invalid);
 for(const [kind,host]of peers(f,async(repo,request)=>{writes++;request.onStart();return {ok:true};})){
  if(host.plan){
   const otherPlan=await host.plan(f.address,f.binding);
   await assert.rejects(host.prepare({...f.address,planToken:p.planToken,operationIds:['one'],unitIds:['one'],direction:kind},f.binding),invalid);
   await assert.rejects(f.prepare(otherPlan,{direction:kind}),invalid);
   // The rejected foreign presentation must not consume the issuing store.
   await host.prepare({...f.address,planToken:otherPlan.planToken,operationIds:['one'],unitIds:['one']},f.binding);
  }
  const r=await peerPreview(kind,host,f);
  await assert.rejects(host.confirm({...f.address,token:q.token,operationKind:kind},f.binding),invalid);
  await assert.rejects(f.confirm(r,{operationKind:'line-index-'+direction}),invalid);
  assert.equal(writes,0);
  await host.confirm({...f.address,token:r.token},f.binding);assert.equal(writes,1);writes=0;
 }
 assert.equal(f.calls.select.length,1);assert.equal(f.calls.apply.length,0);
 await f.confirm(q);await f.prepare(p);
});

test(direction+': selection accepts all 8000 line operations, not a 4000 block/side cap',async()=>{
 const f=fixture();
 const operations=Array.from({length:8000},(_,i)=>({id:'op-'+i,kind:i<4000?'delete':'insert'}));
 f.snapshot.plan=Object.freeze({id:'large',operations:Object.freeze(operations)});
 const ids=operations.map(op=>op.id),p=await f.plan();
 await f.prepare(p,{operationIds:ids});assert.equal(f.calls.select[0].request.operationIds.length,8000);
 f.snapshot.plan={operations:[...operations,{id:'over'}]};
 const tooMany=await f.plan();await assert.rejects(f.prepare(tooMany,{operationIds:[...ids,'over']}),invalid);
 await assert.rejects(f.prepare(tooMany),invalid);
});

test(direction+': factory maps have independent default capacity and lifecycle',async()=>{
 const f=fixture();let writes=0;
 for(const [kind,host]of peers(f,async(repo,request)=>{writes++;request.onStart();return {ok:true};}).slice(0,2)){
  const kp=await host.plan(f.address,f.binding),kq=await peerPreview(kind,host,f);
  const plans=[];for(let i=0;i<33;i++)plans.push(await f.plan());
  await assert.rejects(f.prepare(plans[0]),invalid);
  const previews=[];for(let i=0;i<33;i++)previews.push(await f.prepare(await f.plan()));
  await assert.rejects(f.confirm(previews[0]),invalid);
  f.host.invalidate(f.binding.entry);f.host.clear();
  await host.prepare({...f.address,planToken:kp.planToken,operationIds:['one']},f.binding);
  await host.confirm({...f.address,token:kq.token},f.binding);
 }
 assert.equal(writes,2);
});

test(direction+': confirmation mutex excludes every peer both ways; read phases acquire no locks',async()=>{
 for(const peerIndex of [0,1,2,3,4,5])for(const lineFirst of [true,false]){
  let unlock,started;const gate=new Promise(r=>{unlock=r;}),began=new Promise(r=>{started=r;});
  const execute=async(repo,request)=>{request.onStart();started();await gate;return {ok:true};};
  const f=fixture({api:{['applyLineIndex'+suffix]:execute}}),[kind,other]=peers(f,execute)[peerIndex];
  const p=await f.prepare(await f.plan()),q=await peerPreview(kind,other,f);
  const peerConfirm=()=>other.confirm({...f.address,token:q.token},f.binding);
  const pending=lineFirst?f.confirm(p):peerConfirm();await began;
  try{
   assert.throws(()=>acquireRepositoryAccess(f.binding.repository.root),{code:'vcs/busy'});
   await assert.rejects(lineFirst?peerConfirm():f.confirm(p),{code:'vcs/busy'});
   await f.prepare(await f.plan()); // Host, not these adapters, owns read locking.
  }finally{unlock();await pending;}
  await assert.rejects(lineFirst?peerConfirm():f.confirm(p),invalid);
  acquireRepositoryAccess(f.binding.repository.root,true)();
 }
 const f=fixture(),q=await f.prepare(await f.plan()),release=acquireRepositoryAccess(f.binding.repository.root);
 try{await assert.rejects(f.confirm(q),{code:'vcs/busy'});await f.prepare(await f.plan());}finally{release();}
 await assert.rejects(f.confirm(q),invalid);assert.equal(f.calls.apply.length,0);
});

test(direction+': pre-start authorization and cancellation burn without applying and release mutex',async()=>{
 for(const kind of ['abort','denial']){
  const f=fixture(),q=await f.prepare(await f.plan()),controller=new AbortController(),denied=Error('denied');
  if(kind==='abort')controller.abort();
  const binding={...f.binding,signal:controller.signal,assertAuthorized:async()=>{if(kind==='denial')throw denied;}};
  await assert.rejects(f.confirm(q,{},binding),kind==='abort'?{name:'AbortError'}:e=>e===denied);
  assert.equal(f.calls.apply.length,0);await assert.rejects(f.confirm(q),invalid);
  acquireRepositoryAccess(f.binding.repository.root,true)();
 }
});
}
