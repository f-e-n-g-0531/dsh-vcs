import test from 'node:test';
import assert from 'node:assert/strict';
import {createBranchCreateCoordinator} from '../branch-create-host.mjs';
import {createBranchSwitchCoordinator,acquireRepositoryAccess} from '../branch-switch-host.mjs';
import {createCommitCoordinator} from '../commit-host.mjs';
import {createAmendCoordinator} from '../amend-host.mjs';
import {createIndexStageCoordinator} from '../index-stage-host.mjs';
import {createIndexUnstageCoordinator} from '../index-change-host.mjs';

const invalid={code:'vcs/branch-create-confirmation-invalid'};
const person=()=>({name:'Author',email:'a@example.test',timestamp:123,timezone:'+0800'});
let id=0;
function fixture({api:overrides={},...config}={}){
 let now=100;
 const address={sessionId:'session',repositoryId:'repo',name:'feature/new'};
 const snapshot={action:'untrusted-action',name:address.name,ref:'refs/heads/'+address.name,target:{oid:'a'.repeat(40),raw:Buffer.from('secret')},head:'a'.repeat(40),currentRef:'refs/heads/main',objectFormat:'sha1',raw:Buffer.from('secret'),fingerprint:'secret'};
 const options={entry:{},repository:{type:'git',root:'/branch-create-host-'+ ++id,private:'not forwarded'},cwd:'/cwd',assertAuthorized:async()=>{}};
 const prepared=[],applied=[];
 const api={async prepareBranchCreate(repository,request){assert.equal(this,api);prepared.push({repository,request});return snapshot;},async applyBranchCreate(repository,request){assert.equal(this,api);applied.push({repository,request});request.onStart();return {ref:snapshot.ref};},...overrides};
 const host=createBranchCreateCoordinator({api,now:()=>now,...config});
 return {host,address,snapshot,options,prepared,applied,setNow:value=>{now=value;},prepare:(extra={},binding=options)=>host.prepare({...address,...extra},binding),confirm:(p,extra={},binding=options)=>host.confirm({...address,...extra,token:p.token},binding)};
}

test('safe explicit projection, original private authority, forwarding and single use',async()=>{
 const f=fixture(),signal=new AbortController().signal,p=await f.prepare({},{...f.options,signal});
 assert.deepEqual(p,{action:'branch-create',name:f.snapshot.name,ref:f.snapshot.ref,target:{oid:f.snapshot.head},head:f.snapshot.head,currentRef:f.snapshot.currentRef,objectFormat:'sha1',token:p.token,expiresAt:60100});
 assert.match(p.token,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(p).includes('secret'),false);
 assert.deepEqual(f.prepared[0],{repository:{type:'git',root:f.options.repository.root},request:{name:f.address.name,signal}});
 p.target.oid='tamper';p.name='tamper';p.ref='tamper';assert.equal(f.snapshot.target.oid,f.snapshot.head);
 await f.confirm(p,{action:'commit',operationKind:'branch-switch',name:'another',snapshot:{},target:{oid:'tamper'}},{...f.options,signal});
 const call=f.applied[0];assert.deepEqual(call.repository,{type:'git',root:f.options.repository.root});assert.equal(call.request.snapshot,f.snapshot);assert.equal(call.request.signal,signal);assert.equal(call.request.assertAuthorized,f.options.assertAuthorized);
 assert.deepEqual(Object.keys(call.request).sort(),['snapshot','signal','assertAuthorized','onStart'].sort());
 await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,1);
});

test('TTL boundary, custom capacity and default oldest-token eviction',async()=>{
 const f=fixture({ttlMs:10,maxTokens:2}),p=await f.prepare();f.setNow(109);await f.confirm(p);
 const q=await f.prepare();f.setNow(q.expiresAt);await assert.rejects(f.confirm(q),invalid);
 const tokens=[await f.prepare(),await f.prepare(),await f.prepare()];await assert.rejects(f.confirm(tokens[0]),invalid);await f.confirm(tokens[1]);await f.confirm(tokens[2]);
 const g=fixture(),many=[];for(let i=0;i<33;i++)many.push(await g.prepare());await assert.rejects(g.confirm(many[0]),invalid);await g.confirm(many[1]);await g.confirm(many[32]);
});

test('all binding mismatches burn tokens; grant-specific invalidation and disposal',async()=>{
 for(const patch of [{sessionId:'other'},{repositoryId:'other'}]){const f=fixture(),p=await f.prepare();await assert.rejects(f.confirm(p,patch),invalid);await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,0);}
 for(const change of [f=>({...f.options,entry:{}}),f=>({...f.options,repository:{...f.options.repository}}),f=>({...f.options,cwd:'/other'})]){const f=fixture(),p=await f.prepare();await assert.rejects(f.confirm(p,{},change(f)),invalid);await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,0);}
 const f=fixture(),other={...f.options,entry:{}},p=await f.prepare(),q=await f.prepare({},other);f.host.invalidate(f.options.entry);await assert.rejects(f.confirm(p),invalid);await f.confirm(q,{},other);const r=await f.prepare();f.host.clear();await assert.rejects(f.confirm(r),invalid);
});

test('prepare and pre-start cancellation or authorization failure do not execute',async()=>{
 const f=fixture(),denied=Object.assign(Error('denied'),{code:'denied'}),bad={...f.options,assertAuthorized:async()=>{throw denied;}};
 await assert.rejects(f.prepare({},bad),e=>e===denied);
 const controller=new AbortController();controller.abort();const aborted={...f.options,signal:controller.signal};await assert.rejects(f.prepare({},aborted),{name:'AbortError'});
 for(const binding of [bad,aborted]){const p=await f.prepare();await assert.rejects(f.confirm(p,{},binding));await assert.rejects(f.confirm(p),invalid);}assert.equal(f.applied.length,0);
});

test('pre-start failure remains specific; started failure, cancellation and auth loss are unknown, without retry',async()=>{
 const failure=Object.assign(Error('sensitive'),{code:'vcs/stale'});
 const pre=fixture({api:{applyBranchCreate:async()=>{throw failure;}}}),p=await pre.prepare();await assert.rejects(pre.confirm(p),e=>e===failure);await assert.rejects(pre.confirm(p),invalid);
 for(const kind of ['throw','abort','auth']){
  let calls=0,checks=0;const controller=new AbortController();
  const f=fixture({api:{applyBranchCreate:async(repo,request)=>{calls++;request.onStart();if(kind==='throw')throw failure;if(kind==='abort')controller.abort();return {};}}}),q=await f.prepare();
  await assert.rejects(f.confirm(q,{},{...f.options,signal:controller.signal,assertAuthorized:async()=>{if(++checks===2&&kind==='auth')throw failure;}}),e=>{assert.equal(e.code,'vcs/branch-create-outcome-unknown');assert.match(e.message,/inspect refs and HEAD/);assert.match(e.message,/Never retry automatically or roll back/);assert.equal(e.message.includes('sensitive'),false);return true;});
  await assert.rejects(f.confirm(q),invalid);assert.equal(calls,1);acquireRepositoryAccess(f.options.repository.root,true)();
 }
});

function peer(kind,execute){
 const identity=person(),snapshot={head:'a'.repeat(40),ref:'refs/heads/main',objectFormat:'sha1',commit:{oid:'b'.repeat(40)},author:identity,committer:identity,parents:[],message:'subject'};
 const address={sessionId:'session',repositoryId:'repo',branch:'next',path:'a'};
 if(kind==='commit')return {host:createCommitCoordinator({api:{prepareCommitPreview:async()=>snapshot,applyCommitPreview:execute}}),address:{sessionId:'session',repositoryId:'repo',author:identity,committer:identity,message:'subject'}};
 if(kind==='amend')return {host:createAmendCoordinator({api:{prepareAmendPreview:async()=>snapshot,applyAmendPreview:execute}}),address:{sessionId:'session',repositoryId:'repo',committer:identity,message:'subject'}};
 if(kind==='stage')return {host:createIndexStageCoordinator({api:{prepareIndexStage:async()=>({}),applyIndexStage:execute}}),address};
 if(kind==='unstage')return {host:createIndexUnstageCoordinator({api:{prepareIndexUnstage:async()=>({}),applyIndexUnstage:execute}}),address};
 if(kind==='create')return {host:createBranchCreateCoordinator({api:{prepareBranchCreate:async()=>({target:{oid:'a'}}),applyBranchCreate:execute}}),address:{sessionId:'session',repositoryId:'repo',name:'other'}};
 return {host:createBranchSwitchCoordinator({api:{prepareLocalBranchSwitch:async()=>({}),switchLocalBranch:execute}}),address};
}
for(const kind of ['switch','commit','amend','stage','unstage','create']){
 test('identical bindings cannot cross '+kind+' tokens in either direction',async()=>{
  const f=fixture();let writes=0;const other=peer(kind,async()=>{writes++;return {};});const p=await f.prepare(),q=await other.host.prepare(other.address,f.options);
  await assert.rejects(other.host.confirm({...other.address,token:p.token},f.options));await assert.rejects(f.confirm(q),invalid);assert.equal(writes,0);assert.equal(f.applied.length,0);
  await f.confirm(p);await other.host.confirm({...other.address,token:q.token},f.options);assert.equal(writes,1);
 });
 for(const createFirst of [true,false])test('shared '+kind+' writer exclusion, create first='+createFirst,async()=>{
  let unlock,start;const gate=new Promise(r=>{unlock=r;}),began=new Promise(r=>{start=r;});const execute=async(repo,request)=>{request.onStart();start();await gate;return {};};
  const f=fixture({api:{applyBranchCreate:execute}}),other=peer(kind,execute),p=await f.prepare(),q=await other.host.prepare(other.address,f.options);
  const peerConfirm=()=>other.host.confirm({...other.address,token:q.token},f.options);
  const pending=createFirst?f.confirm(p):peerConfirm();await began;
  try{assert.throws(()=>acquireRepositoryAccess(f.options.repository.root),{code:'vcs/busy'});assert.throws(()=>acquireRepositoryAccess(f.options.repository.root,true),{code:'vcs/busy'});await assert.rejects(createFirst?peerConfirm():f.confirm(p),{code:'vcs/busy'});}finally{unlock();await pending;}
  await assert.rejects(createFirst?peerConfirm():f.confirm(p));acquireRepositoryAccess(f.options.repository.root,true)();
 });
}

test('existing reader blocks create and burns token; release restores access',async()=>{
 const f=fixture(),p=await f.prepare(),release=acquireRepositoryAccess(f.options.repository.root);try{await assert.rejects(f.confirm(p),{code:'vcs/busy'});}finally{release();}await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,0);await f.confirm(await f.prepare());
});

test('own scalar input and session binding captured before adapter await',async()=>{
 let resume,request;const gate=new Promise(r=>{resume=r;});
 const f=fixture({api:{prepareBranchCreate:async(repo,value)=>{request=value;await gate;return {...f.snapshot,name:value.name};}}}),original={...f.address};
 const pending=f.host.prepare(f.address,f.options);f.address.name='changed';f.address.sessionId='other';f.address.repositoryId='other';resume();const p=await pending;
 assert.equal(request.name,original.name);assert.equal(p.name,original.name);await f.host.confirm({...original,token:p.token},f.options);
});

test('strict own-data address rejects missing, extra, symbol, accessor and inherited fields before API',async()=>{
 const f=fixture();let getters=0;const getter=()=>{getters++;throw Error('getter invoked');};
 const bad=[null,[],42,'name',Object.create(f.address),{...f.address,extra:1},{...f.address,[Symbol('extra')]:1}];
 for(const key of ['sessionId','repositoryId','name']){
  const missing={...f.address};delete missing[key];bad.push(missing);
  const accessor={...f.address};Object.defineProperty(accessor,key,{get:getter,enumerable:true});bad.push(accessor);
 }
 for(const key of ['oid','ref','target','snapshot','token','operationKind','root'])bad.push({...f.address,[key]:'not allowed'});
 for(const key of ['sessionId','repositoryId'])for(const value of ['',null,1,{},undefined])bad.push({...f.address,[key]:value});
 for(const value of bad)await assert.rejects(f.host.prepare(value,f.options),invalid);
 assert.equal(getters,0);assert.equal(f.prepared.length,0);
 const own=Object.assign(Object.create(null),f.address);await f.host.prepare(own,f.options);assert.equal(f.prepared.length,1);
});

const badNames=['',null,1,{},undefined,'@','HEAD','head','HeAd','-new','refs/heads/a','a//b','/a','a/','.a','a/.b','a.','a/b.','a.lock','a.LoCk','con','AUX.txt','a/com1','LPT9.txt','a..b','a@{b','a b','a~b','a^b','a:b','a?b','a*b','a[b','a\\b','a<b','a>b','a"b','a|b','a\0b','a\nb','a\tb','a\x7fb','a\u0085b','a\u200db','a\u202eb','\ud800','\udfff','a'.repeat(256),'中'.repeat(86),Array(4).fill('a'.repeat(250)).join('/')];
for(const [index,name] of badNames.entries())test('reject unsafe branch name #'+index,async()=>{const f=fixture();await assert.rejects(f.prepare({name}),invalid);assert.equal(f.prepared.length,0);});
for(const name of ['feature/new','中文/分支','é'.repeat(127)+'a','a'.repeat(255),Array(4).fill('a'.repeat(249)).join('/')+'a','emoji/😀','CONsole','topic@name'])test('accept portable bounded name '+name.slice(0,20),async()=>{const f=fixture();await f.prepare({name});assert.equal(f.prepared[0].request.name,name);});

test('generic TTL and capacity configuration validation is retained',()=>{
 for(const config of [{ttlMs:0},{ttlMs:Infinity},{maxTokens:0},{maxTokens:1.5}])assert.throws(()=>fixture(config),TypeError);
});
