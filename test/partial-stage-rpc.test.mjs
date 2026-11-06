import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../index.mjs';
const id='a'.repeat(64),unit='c'.repeat(64),oid='b'.repeat(40);
function fixture({type='git',root='/rpc-partial-'+Math.random(),apply,plan,select,timeout=15000,clock=Date.now,ttlMs}={}){
 let cwd=root,writes=0,plans=0,selects=0,clears=0;
 const snapshot=()=>({path:'selected.txt',head:oid,index:{oid},plan:{id:'d'.repeat(64),units:[{id:unit}]},fingerprint:'private',bytes:Buffer.from('private')});
 const api={discoverRepositories:async()=>({repositories:[{id:'r',type,root},{id:'r2',type,root:root+'/second'}],warnings:[]}),
 preparePartialIndexStage:async(repo,r)=>{plans++;assert.deepEqual(Object.keys(r).sort(),['id','signal']);assert.equal(r.id,id);return plan?plan(r):snapshot();},
 selectPartialIndexStage:async(repo,r)=>{selects++;assert.deepEqual(Object.keys(r).sort(),['signal','snapshot','unitIds']);assert.deepEqual(r.unitIds,[unit]);return select?select(r):{path:r.snapshot.path,head:oid,index:{oid},target:{oid},planId:r.snapshot.plan.id,unitIds:[...r.unitIds],fingerprint:'private'};},
 applyIndexStage:async(repo,r)=>{writes++;return apply?apply(r):(r.onStart(),{path:r.snapshot.path});},
 prepareSelectedIndexStage:async()=>({path:'whole.txt',head:oid,index:{oid},target:{oid}}),
 prepareSelectedIndexUnstage:async()=>({path:'staged.txt',head:oid,index:{oid},target:{oid}}),applyIndexUnstage:async(repo,r)=>(r.onStart(),{}),
 listChanges:async()=>{throw Error('ordinary status must not resolve partial selection');},listLocalBranches:async()=>({branches:[]}),
 prepareLocalBranchSwitch:async()=>({current:{},target:{}}),switchLocalBranch:async(repo,r)=>(r.onStart(),{}),clearHistoricalCache:()=>clears++};
 const handle=createHandler({sessions:{get:()=>({header:{cwd}})}},api,4,{operationTimeoutMs:timeout,now:clock,...(ttlMs?{ttlMs}:{})});
 return {handle,address:{sessionId:'s',repositoryId:'r'},setCwd:v=>cwd=v,writes:()=>writes,plans:()=>plans,selects:()=>selects,clears:()=>clears};
}
const discover=f=>f.handle('vcs/repositories',{sessionId:'s'});
const plan=(f,signal)=>f.handle('vcs/partial-stage-plan',{...f.address,id},signal);
const prepare=(f,planToken,signal)=>f.handle('vcs/partial-stage-prepare',{...f.address,planToken,unitIds:[unit]},signal);
const confirm=(f,token,signal)=>f.handle('vcs/partial-stage-confirm',{...f.address,token},signal);
async function ready(f){const p=await plan(f);assert.equal(p.ok,true,JSON.stringify(p));const q=await prepare(f,p.value.planToken);assert.equal(q.ok,true,JSON.stringify(q));return q;}
const code=(r,c)=>assert.equal(r.error?.code,c,JSON.stringify(r));

test('authenticated Git three-phase projection, single-use plans and confirmations',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());code(await plan(f),'vcs/rediscover-required');await discover(f);
 const p=await plan(f);assert.equal(p.ok,true);assert.deepEqual(Object.keys(p.value).sort(),['action','expiresAt','head','index','path','plan','planToken']);assert.equal(p.value.action,'partial-stage');assert.match(p.value.planToken,/^[a-f0-9]{64}$/);
 const q=await prepare(f,p.value.planToken);assert.equal(q.ok,true,JSON.stringify(q));assert.deepEqual(Object.keys(q.value).sort(),['action','expiresAt','head','index','path','planId','target','token','unitIds']);assert.equal(q.value.action,'partial-stage');assert.deepEqual(q.value.unitIds,[unit]);
 assert.equal((await prepare(f,p.value.planToken)).ok,false);const clears=f.clears();assert.equal((await confirm(f,q.value.token)).ok,true);assert.ok(f.clears()>clears);code(await confirm(f,q.value.token),'vcs/index-confirmation-invalid');assert.equal(f.writes(),1);
});

test('exact payload keys reject raw paths, caller snapshots, symbols, missing and inherited fields without getters',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);let getters=0;
 for(const endpoint of ['plan','prepare','confirm']){
  const base=endpoint==='plan'?{...f.address,id}:endpoint==='prepare'?{...f.address,planToken:id,unitIds:[unit]}:{...f.address,token:id};
  for(const extra of [{path:'x'},{snapshot:{}},{root:'/bad'},{mode:'unstaged'},{action:'partial-stage'},{[Symbol('hidden')]:1}])code(await f.handle('vcs/partial-stage-'+endpoint,{...base,...extra}),'vcs/invalid-request');
  for(const field of Object.keys(base)){
   const missing={...base};delete missing[field];code(await f.handle('vcs/partial-stage-'+endpoint,missing),'vcs/invalid-request');
   const inherited=Object.assign(Object.create({[field]:base[field]}),missing);code(await f.handle('vcs/partial-stage-'+endpoint,inherited),'vcs/invalid-request');
   const accessor={...base};Object.defineProperty(accessor,field,{enumerable:true,get(){getters++;throw Error('must not execute');}});code(await f.handle('vcs/partial-stage-'+endpoint,accessor),'vcs/invalid-request');
  }
 }
 assert.equal(getters,0);assert.equal(f.plans(),0);assert.equal(f.selects(),0);assert.equal(f.writes(),0);
});

test('hex tokens and bounded unique own-data unit ID arrays are validated before adapter access',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);let getters=0;
 const accessor=[unit];Object.defineProperty(accessor,'0',{get(){getters++;return unit;}});
 const inherited=Array(1);Object.setPrototypeOf(inherited,{0:unit});
 for(const ids of [[],Array(4001).fill(unit),[unit,unit],['A'.repeat(64)],['x'],[null],Array(1),inherited,accessor,Object.assign([unit],{extra:1}),{0:unit,length:1}])code(await f.handle('vcs/partial-stage-prepare',{...f.address,planToken:id,unitIds:ids}),'vcs/invalid-request');
 for(const token of ['x','A'.repeat(64),null,1]){code(await prepare(f,token),'vcs/invalid-request');code(await confirm(f,token),'vcs/invalid-request');code(await f.handle('vcs/partial-stage-plan',{...f.address,id:token}),'vcs/invalid-request');}
 assert.equal(getters,0);assert.equal(f.selects(),0);
});

test('SVN is refused at every phase before invoking partial APIs',async t=>{
 const f=fixture({type:'svn'});t.after(()=>f.handle.dispose());await discover(f);for(const r of [await plan(f),await prepare(f,id),await confirm(f,id)])code(r,'vcs/invalid-request');assert.equal(f.plans()+f.selects()+f.writes(),0);
});

test('cross-phase and whole-file tokens cannot authorize partial writes',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);const p=await plan(f),whole=await f.handle('vcs/index-stage-prepare',{...f.address,id});
 code(await confirm(f,p.value.planToken),'vcs/index-confirmation-invalid');code(await confirm(f,whole.value.token),'vcs/index-confirmation-invalid');assert.equal((await prepare(f,whole.value.token)).ok,false);
 const q=await prepare(f,p.value.planToken);assert.equal(q.ok,true);code(await f.handle('vcs/index-stage-confirm',{...f.address,token:q.value.token}),'vcs/index-confirmation-invalid');assert.equal((await prepare(f,q.value.token)).ok,false);assert.equal((await confirm(f,q.value.token)).ok,true);
});

test('Session/repository scope, cwd revocation, rediscovery, expiry and disposal invalidate both phases',async t=>{
 let now=1000;const f=fixture({clock:()=>now});t.after(()=>f.handle.dispose());await discover(f);let p=await plan(f);
 code(await f.handle('vcs/partial-stage-prepare',{...f.address,sessionId:'other',planToken:p.value.planToken,unitIds:[unit]}),'vcs/rediscover-required');
 assert.equal((await f.handle('vcs/partial-stage-prepare',{...f.address,repositoryId:'r2',planToken:p.value.planToken,unitIds:[unit]})).ok,false);
 let q=await ready(f);assert.equal((await f.handle('vcs/partial-stage-confirm',{...f.address,repositoryId:'r2',token:q.value.token})).ok,false);
 p=await plan(f);q=await ready(f);await discover(f);assert.equal((await prepare(f,p.value.planToken)).ok,false);code(await confirm(f,q.value.token),'vcs/index-confirmation-invalid');
 p=await plan(f);q=await ready(f);now+=60001;assert.equal((await prepare(f,p.value.planToken)).ok,false);code(await confirm(f,q.value.token),'vcs/index-confirmation-invalid');
 q=await ready(f);f.setCwd('/changed');code(await confirm(f,q.value.token),'vcs/rediscover-required');await discover(f);q=await ready(f);f.handle.dispose();code(await confirm(f,q.value.token),'vcs/rediscover-required');assert.equal(f.writes(),0);
});

test('expired discovery grant and state change during either read cannot issue usable capability',async t=>{
 let now=1000;const f=fixture({clock:()=>now,ttlMs:10});t.after(()=>f.handle.dispose());await discover(f);const q=await ready(f);now+=11;code(await confirm(f,q.value.token),'vcs/rediscover-required');
 let g;g=fixture({plan:async()=>{g.setCwd('/revoked');return {};}});t.after(()=>g.handle.dispose());await discover(g);code(await plan(g),'vcs/rediscover-required');
 let h;h=fixture({select:async()=>{h.setCwd('/revoked');return {};}});t.after(()=>h.handle.dispose());await discover(h);const p=await plan(h);code(await prepare(h,p.value.planToken),'vcs/rediscover-required');
});

test('adapter stale and pre-start cancellation consume confirmation without unknown mapping',async t=>{
 for(const [error,expected] of [[Object.assign(Error('changed'),{code:'vcs/index-stale'}),'vcs/index-stale'],[Object.assign(Error('cancel'),{name:'AbortError'}),'vcs/cancelled']]){
  const f=fixture({apply:async()=>{throw error;}});t.after(()=>f.handle.dispose());await discover(f);const q=await ready(f);code(await confirm(f,q.value.token),expected);code(await confirm(f,q.value.token),'vcs/index-confirmation-invalid');
 }
});

test('cancellation, state revocation and unknown errors after start retain append-only warning',async t=>{
 for(const mode of ['abort','state','unknown']){
  const controller=new AbortController();let f;f=fixture({apply:async r=>{if(mode!=='unknown')r.onStart();if(mode==='state'){f.setCwd('/revoked');return {};}controller.abort();if(mode==='unknown')throw Object.assign(Error('append-only uncertain'),{code:'vcs/index-outcome-unknown'});r.signal.throwIfAborted();}});
  t.after(()=>f.handle.dispose());await discover(f);const q=await ready(f);const r=await confirm(f,q.value.token,controller.signal);code(r,'vcs/index-outcome-unknown');if(mode!=='unknown')assert.match(r.error.message,/Append-only object writes/);
 }
 const f=fixture(),controller=new AbortController();t.after(()=>f.handle.dispose());await discover(f);const q=await ready(f);controller.abort();code(await confirm(f,q.value.token,controller.signal),'vcs/index-outcome-unknown');assert.equal(f.writes(),0);
});

test('outer post-work budget failure after publishing stays unknown and clears cache',async t=>{
 const f=fixture({timeout:25,apply:async r=>{r.onStart();await new Promise(resolve=>setTimeout(resolve,60));return {};}});t.after(()=>f.handle.dispose());await discover(f);const q=await ready(f),clears=f.clears();const r=await confirm(f,q.value.token);code(r,'vcs/index-outcome-unknown');assert.match(r.error.message,/Append-only object writes/);assert.ok(f.clears()>clears);assert.equal(f.writes(),1);
});

test('partial reads and confirms share process mutex with ordinary readers and other index/branch writers',async t=>{
 let finish,start;const gate=new Promise(r=>finish=r),started=new Promise(r=>start=r),root='/rpc-partial-shared-'+Math.random();
 const f=fixture({root,apply:async r=>{r.onStart();start();await gate;return {};}}),g=fixture({root});t.after(()=>{finish();f.handle.dispose();g.handle.dispose();});await discover(f);await discover(g);
 const gp=await plan(g),gq=await ready(g),whole=await g.handle('vcs/index-stage-prepare',{...g.address,id}),branch=await g.handle('vcs/branch-switch-prepare',{...g.address,branch:'next'}),q=await ready(f);
 const pending=confirm(f,q.value.token);await started;
 for(const r of [await plan(g),await prepare(g,gp.value.planToken),await confirm(g,gq.value.token),await g.handle('vcs/branches',g.address),await g.handle('vcs/index-stage-confirm',{...g.address,token:whole.value.token}),await g.handle('vcs/branch-switch-confirm',{...g.address,token:branch.value.token})])code(r,'vcs/busy');
 finish();assert.equal((await pending).ok,true);assert.equal((await plan(g)).ok,true);
});

test('plan and prepare retain reader locks while adapter work is running',async t=>{
 for(const phase of ['plan','prepare']){
  let finish,start;const gate=new Promise(r=>finish=r),started=new Promise(r=>start=r),root='/rpc-partial-reader-'+Math.random();
  const block=async r=>{start();await gate;return phase==='plan'?{path:'x',head:oid,index:{oid},plan:{id,units:[{id:unit}]}}:{path:'x',head:oid,index:{oid},target:{oid},planId:id,unitIds:[unit]};};
  const f=fixture({root,...(phase==='plan'?{plan:block}:{select:block})}),g=fixture({root});t.after(()=>{finish();f.handle.dispose();g.handle.dispose();});await discover(f);await discover(g);const q=await ready(g),p=phase==='prepare'?await plan(f):null;
  const pending=phase==='plan'?plan(f):prepare(f,p.value.planToken);await started;code(await confirm(g,q.value.token),'vcs/busy');finish();assert.equal((await pending).ok,true);
 }
});
