import test from 'node:test';
import assert from 'node:assert/strict';
import {createConfirmedOperationCoordinator,acquireRepositoryAccess} from '../confirmed-operation.mjs';
import {createBranchSwitchCoordinator,acquireRepositoryAccess as branchAccess} from '../branch-switch-host.mjs';

let rootId=0;
function fixture(config={}){
 let now=100,writes=0;
 const snapshot={privateSecret:'server-only',current:'main',target:'next'};
 const address={sessionId:'session',repositoryId:'repository'};
 const options={entry:{},repository:{root:'/confirmed-operation-test-'+ ++rootId},cwd:'/cwd',assertAuthorized:async()=>{}};
 const host=createConfirmedOperationCoordinator({operationKind:'test-write',now:()=>now,
  prepare:async()=>snapshot,
  execute:async(repository,request)=>{writes++;assert.equal(request.snapshot,snapshot);request.onStart();return {ok:true};},
  ...config});
 return {host,address,options,snapshot,writes:()=>writes,setNow:value=>{now=value;},
  prepare:()=>host.prepare(address,options),
  confirm:(prepared,extra={},binding=options)=>host.confirm({...address,...extra,token:prepared.token},binding)};
}
const invalid={code:'vcs/confirmation-invalid'};

test('generic confirmations expose no snapshot by default and execute only the retained snapshot once',async()=>{
 const f=fixture(),prepared=await f.prepare();
 assert.deepEqual(Object.keys(prepared).sort(),['expiresAt','token']);
 assert.match(prepared.token,/^[a-f0-9]{64}$/);
 assert.equal(prepared.expiresAt,60100);
 assert.equal(JSON.stringify(prepared).includes('server-only'),false);
 assert.deepEqual(await f.confirm(prepared,{snapshot:{privateSecret:'browser'},command:'rm',action:'other',operationKind:'other'}),{ok:true});
 await assert.rejects(f.confirm(prepared),invalid);
 assert.equal(f.writes(),1);
});

test('operation kind is host-selected, cross-operation and branch replay cannot execute',async()=>{
 assert.throws(()=>createConfirmedOperationCoordinator({prepare(){},execute(){}}),TypeError);
 const first=fixture(),second=fixture({operationKind:'other-write'}),prepared=await first.prepare();
 await assert.rejects(second.host.confirm({...first.address,token:prepared.token,operationKind:'test-write'},first.options),invalid);
 const branch=createBranchSwitchCoordinator({api:{prepareLocalBranchSwitch:async()=>first.snapshot,switchLocalBranch:async()=>assert.fail('wrong operation executed')}});
 await assert.rejects(branch.confirm({...first.address,token:prepared.token},first.options),{code:'vcs/branch-confirmation-invalid'});
 assert.equal(second.writes(),0);
 assert.deepEqual(await first.confirm(prepared),{ok:true});
 const branchPrepared=await branch.prepare({...first.address,branch:'next'},first.options);
 await assert.rejects(first.confirm(branchPrepared),invalid);
});

test('default expiration is exact at 60 seconds and default capacity evicts only the oldest of 32',async()=>{
 const f=fixture(),prepared=await f.prepare();
 f.setNow(60099);await f.confirm(prepared);
 const expired=await f.prepare();f.setNow(expired.expiresAt);
 await assert.rejects(f.confirm(expired),invalid);
 const g=fixture(),tokens=[];
 for(let i=0;i<33;i++)tokens.push(await g.prepare());
 await assert.rejects(g.confirm(tokens[0]),invalid);
 for(const token of tokens.slice(1))await g.confirm(token);
 assert.equal(g.writes(),32);
});

test('every binding mismatch burns its token even when repository roots are equal',async()=>{
 for(const change of [f=>({...f.options,entry:{}}),f=>({...f.options,repository:{...f.options.repository}}),f=>({...f.options,cwd:'/different'})]){
  const f=fixture(),prepared=await f.prepare();
  await assert.rejects(f.confirm(prepared,{},change(f)),invalid);
  await assert.rejects(f.confirm(prepared),invalid);assert.equal(f.writes(),0);
 }
 for(const change of [{sessionId:'other'},{repositoryId:'other'}]){
  const f=fixture(),prepared=await f.prepare();
  await assert.rejects(f.confirm(prepared,change),invalid);
  await assert.rejects(f.confirm(prepared),invalid);assert.equal(f.writes(),0);
 }
});

test('injected api retains method receiver and explicit public projection is opt-in',async()=>{
 const snapshot={secret:'hidden',summary:'safe'};
 const api={snapshot,prepare(){return this.snapshot;},execute(repository,{snapshot:retained}){assert.equal(retained,this.snapshot);return 'done';}};
 const f=fixture({api,prepare:api.prepare,execute:api.execute,project:value=>({summary:value.summary})});
 const prepared=await f.prepare();assert.equal(prepared.summary,'safe');assert.equal(prepared.secret,undefined);
 assert.equal(await f.confirm(prepared),'done');
 const direct=createConfirmedOperationCoordinator({operationKind:'api-direct',api});
 const token=await direct.prepare(f.address,f.options);
 assert.equal(await direct.confirm({...f.address,token:token.token},f.options),'done');
});

test('prepare authorization and cancellation are checked before minting confirmation',async()=>{
 let projects=0;const f=fixture({project:()=>{projects++;return {};}});
 await assert.rejects(f.host.prepare(f.address,{...f.options,assertAuthorized:async()=>{throw Error('revoked');}}),/revoked/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(f.host.prepare(f.address,{...f.options,signal:controller.signal}),{name:'AbortError'});
 assert.equal(projects,0);assert.equal(f.writes(),0);
});

test('confirm authorizes before and after execution and preserves pre-start failures',async()=>{
 const f=fixture(),prepared=await f.prepare();
 await assert.rejects(f.confirm(prepared,{}, {...f.options,assertAuthorized:async()=>{throw Error('revoked');}}),/revoked/);
 await assert.rejects(f.confirm(prepared),invalid);assert.equal(f.writes(),0);
 acquireRepositoryAccess(f.options.repository.root,true)();
 const g=fixture({execute:async()=>{throw Error('pre-start');}}),pending=await g.prepare();
 await assert.rejects(g.confirm(pending),/pre-start/);
 acquireRepositoryAccess(g.options.repository.root,true)();
 let checks=0;const h=fixture(),token=await h.prepare();
 await assert.rejects(h.confirm(token,{}, {...h.options,assertAuthorized:async()=>{if(++checks===2)throw Error('revoked');}}),{code:'vcs/outcome-unknown'});
 assert.equal(checks,2);assert.equal(h.writes(),1);
 acquireRepositoryAccess(h.options.repository.root,true)();
});

test('started failures use operation-specific unknown result while invalid errors are configurable',async()=>{
 const f=fixture({invalidCode:'write/invalid',invalidMessage:'Prepare write again',unknownCode:'write/unknown',unknownMessage:'Inspect write result',
  execute:async(repository,{onStart})=>{onStart();throw Error('private failure');}});
 await assert.rejects(f.confirm({token:'missing'}),{code:'write/invalid',message:'Prepare write again'});
 const token=await f.prepare();
 await assert.rejects(f.confirm(token),{code:'write/unknown',message:'Inspect write result'});
});

test('cancellation before start burns token; cancellation after start reports unknown and releases access',async()=>{
 const f=fixture(),token=await f.prepare(),controller=new AbortController();controller.abort();
 await assert.rejects(f.confirm(token,{}, {...f.options,signal:controller.signal}),{name:'AbortError'});
 await assert.rejects(f.confirm(token),invalid);assert.equal(f.writes(),0);
 acquireRepositoryAccess(f.options.repository.root,true)();
 for(const throwDuring of [true,false]){
  const abort=new AbortController();
  const g=fixture({execute:async(repository,{onStart,signal})=>{onStart();abort.abort();if(throwDuring)signal.throwIfAborted();return {ok:true};}});
  const prepared=await g.prepare();
  await assert.rejects(g.confirm(prepared,{}, {...g.options,signal:abort.signal}),{code:'vcs/outcome-unknown'});
  acquireRepositoryAccess(g.options.repository.root,true)();
 }
});

test('invalidate is entry-specific and clear invalidates all outstanding confirmations',async()=>{
 const f=fixture(),first=await f.prepare(),otherOptions={...f.options,entry:{}};
 const second=await f.host.prepare(f.address,otherOptions);
 f.host.invalidate(f.options.entry);
 await assert.rejects(f.confirm(first),invalid);
 await f.confirm(second,{},otherOptions);
 const third=await f.prepare(),fourth=await f.host.prepare(f.address,otherOptions);
 f.host.clear();
 await assert.rejects(f.confirm(third),invalid);
 await assert.rejects(f.confirm(fourth,{},otherOptions),invalid);
 assert.equal(f.writes(),1);
});

test('generic and branch adapters share process-wide read/write exclusion',async()=>{
 assert.equal(branchAccess,acquireRepositoryAccess);
 const f=fixture(),token=await f.prepare();
 const read=branchAccess(f.options.repository.root),read2=acquireRepositoryAccess(f.options.repository.root);
 try{await assert.rejects(f.confirm(token),{code:'vcs/busy'});assert.equal(f.writes(),0);}finally{read();read();read2();}
 await assert.rejects(f.confirm(token),invalid);
 let finish;const gate=new Promise(resolve=>{finish=resolve;});
 const g=fixture({execute:async(repository,{onStart})=>{onStart();await gate;return {ok:true};}});
 const prepared=await g.prepare();
 const branch=createBranchSwitchCoordinator({api:{prepareLocalBranchSwitch:async()=>({current:'main',target:'next'}),switchLocalBranch:async()=>assert.fail('concurrent writer')}});
 const branchToken=await branch.prepare({...g.address,branch:'next'},g.options);
 const pending=g.confirm(prepared);
 try{
  assert.throws(()=>branchAccess(g.options.repository.root),{code:'vcs/busy'});
  assert.throws(()=>acquireRepositoryAccess(g.options.repository.root,true),{code:'vcs/busy'});
  await assert.rejects(branch.confirm({...g.address,token:branchToken.token},g.options),{code:'vcs/busy'});
 }finally{finish();await pending;}
 acquireRepositoryAccess(g.options.repository.root,true)();
 const branchWriter=branchAccess(g.options.repository.root,true);
 try{assert.throws(()=>acquireRepositoryAccess(g.options.repository.root),{code:'vcs/busy'});}finally{branchWriter();branchWriter();}
});
