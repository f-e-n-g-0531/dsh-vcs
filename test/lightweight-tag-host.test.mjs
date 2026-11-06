import test from 'node:test';
import assert from 'node:assert/strict';
import {createLightweightTagCoordinator} from '../lightweight-tag-host.mjs';
import {createTagCreateCoordinator} from '../tag-create-host.mjs';
import {createBranchCreateCoordinator} from '../branch-create-host.mjs';
import {createCommitCoordinator} from '../commit-host.mjs';
import {createAmendCoordinator} from '../amend-host.mjs';
import {acquireRepositoryAccess} from '../confirmed-operation.mjs';

const invalid={code:'vcs/lightweight-tag-create-confirmation-invalid'};
const person=()=>({name:'Author',email:'author@example.test',timestamp:123,timezone:'+0800'});
let id=0;
function fixture({api:overrides={},...config}={}){
 let now=100;
 const address={sessionId:'session',repositoryId:'repo',name:'release/v1'};
 const snapshot={action:'untrusted',name:address.name,ref:'refs/tags/'+address.name,head:'a'.repeat(40),currentRef:'refs/heads/main',objectFormat:'sha1',targetTree:'b'.repeat(40),planId:'private-plan-id',raw:Buffer.from('secret'),fingerprint:'secret',object:{oid:'c'.repeat(40),body:Buffer.from('secret')},tagger:person(),message:'secret'};
 const options={entry:{},repository:{type:'git',root:'/lightweight-tag-host-'+ ++id,private:'secret'},cwd:'/cwd',assertAuthorized:async()=>{}};
 const prepared=[],applied=[];
 const api={async prepareLightweightTagCreate(repository,request){assert.equal(this,api);prepared.push({repository,request});return snapshot;},async applyLightweightTagCreate(repository,request){assert.equal(this,api);applied.push({repository,request});request.onStart();return {ref:snapshot.ref};},...overrides};
 const host=createLightweightTagCoordinator({api,now:()=>now,...config});
 return {host,address,snapshot,options,prepared,applied,setNow:value=>{now=value;},prepare:(extra={},binding=options)=>host.prepare({...address,...extra},binding),confirm:(p,extra={},binding=options)=>host.confirm({...address,...extra,token:p.token},binding)};
}

test('exact eight scalar public fields plus grant metadata retain original private snapshot identity',async()=>{
 const f=fixture(),signal=new AbortController().signal,p=await f.prepare({},{...f.options,signal});
 const safe={action:'lightweight-tag-create',name:f.snapshot.name,ref:f.snapshot.ref,head:f.snapshot.head,currentRef:f.snapshot.currentRef,objectFormat:'sha1',targetTree:f.snapshot.targetTree,planId:f.snapshot.planId};
 assert.equal(Object.keys(safe).length,8);
 assert.deepEqual(p,{...safe,token:p.token,expiresAt:60100});assert.match(p.token,/^[a-f0-9]{64}$/);
 for(const value of Object.values(p))assert.ok(['string','number'].includes(typeof value));
 assert.equal(JSON.stringify(p).includes('secret'),false);
 assert.deepEqual(f.prepared[0],{repository:{type:'git',root:f.options.repository.root},request:{name:f.address.name,signal}});
 for(const key of Object.keys(safe))p[key]='tamper';
 assert.deepEqual(await f.confirm(p,{action:'commit',operationKind:'amend',name:'other',snapshot:{},planId:'tamper',oid:'tamper'},{...f.options,signal}),{ref:f.snapshot.ref});
 const call=f.applied[0];assert.deepEqual(call.repository,{type:'git',root:f.options.repository.root});
 assert.deepEqual(Object.keys(call.request).sort(),['snapshot','signal','assertAuthorized','onStart'].sort());
 assert.equal(call.request.snapshot,f.snapshot);assert.equal(call.request.signal,signal);assert.equal(call.request.assertAuthorized,f.options.assertAuthorized);
 await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,1);
});

test('capture requires exactly own data session/repository/name fields and never invokes getters',async()=>{
 const f=fixture();let getters=0,checks=0;const getter=()=>{getters++;throw Error('getter invoked');};
 const binding={...f.options,assertAuthorized:async()=>{checks++;}};
 const bad=[null,[],42,'tag',Object.create(f.address),{...f.address,[Symbol('extra')]:1}];
 for(const key of ['sessionId','repositoryId','name']){
  const missing={...f.address};delete missing[key];bad.push(missing);
  for(const enumerable of [true,false]){const value={...f.address};Object.defineProperty(value,key,{get:getter,enumerable});bad.push(value);}
 }
 for(const key of ['tagger','message','oid','OID','ref','object','target','snapshot','token','operationKind','root','planId','extra']){
  bad.push({...f.address,[key]:'forbidden'});
  const value={...f.address};Object.defineProperty(value,key,{get:getter,enumerable:false});bad.push(value);
 }
 for(const value of bad)await assert.rejects(f.host.prepare(value,binding),invalid);
 assert.equal(getters,0);assert.equal(checks,0);assert.equal(f.prepared.length,0);
});

test('portable name and scalar bounds reject before authorization or adapter',async()=>{
 const f=fixture();let checks=0;const binding={...f.options,assertAuthorized:async()=>{checks++;}};
 for(const key of ['sessionId','repositoryId'])for(const value of ['',null,1,{},undefined])await assert.rejects(f.prepare({[key]:value},binding),invalid);
 const bad=['',null,1,Buffer.from('tag'),'@','HEAD','head','HeAd','-tag','refs/tags/a','a//b','/a','a/','.a','a/.b','a.','a.lock','a.LoCk','CON','con.txt','a/PRN','AUX','NUL','COM1','lpt9.txt','a..b','a@{b','a b','a\u0000b','a\u007fb','a\u0085b','a\u200db','a\ufeffb','\ud800','\udfff','a'.repeat(256),'中'.repeat(86),Array(4).fill('a'.repeat(250)).join('/')];
 for(const char of [126,94,58,63,42,91,92,60,62,34,124,9,10].map(n=>String.fromCharCode(n)))bad.push("a"+char+"b");
 for(const name of bad)await assert.rejects(f.prepare({name},binding),invalid);
 assert.equal(f.prepared.length,0);assert.equal(checks,0);
});

test('null-prototype and nonenumerable own fields accept exact UTF-8 component and total boundaries',async()=>{
 const f=fixture();
 const names=['é'.repeat(127)+'a','中'.repeat(85),['a'.repeat(250),'b'.repeat(250),'c'.repeat(250),'d'.repeat(247)].join('/'),'release/版本😀','COM0','LPT10'];
 assert.equal(Buffer.byteLength(names[2]),1000);
 for(const name of names){
  const address=Object.create(null);for(const [key,value]of Object.entries({...f.address,name}))Object.defineProperty(address,key,{value});
  const p=await f.host.prepare(address,f.options);assert.equal(f.prepared.at(-1).request.name,name);await f.host.confirm({...f.address,token:p.token},f.options);
 }
 await assert.rejects(f.prepare({name:names[2]+'d'}),invalid);
});

for(const phase of ['adapter','authorization'])test('input mutation before '+phase+' await cannot change scalars or token bindings',async()=>{
 let resume,entered;const gate=new Promise(r=>{resume=r;}),began=new Promise(r=>{entered=r;});
 const f=fixture({api:phase==='adapter'?{prepareLightweightTagCreate:async(repository,request)=>{f.prepared.push({repository,request});entered();await gate;return f.snapshot;}}:{}});
 const original={...f.address},binding=phase==='authorization'?{...f.options,assertAuthorized:async()=>{entered();await gate;}}:f.options;
 const pending=f.host.prepare(f.address,binding);await began;
 f.address.name='changed';f.address.sessionId='changed';f.address.repositoryId='changed';resume();const p=await pending;
 assert.equal(f.prepared[0].request.name,original.name);
 await f.host.confirm({...original,token:p.token},f.options);assert.equal(f.applied[0].request.snapshot,f.snapshot);
});

test('TTL boundary and configured/default oldest-grant capacity',async()=>{
 const f=fixture({ttlMs:10,maxTokens:2}),p=await f.prepare();f.setNow(109);await f.confirm(p);
 const q=await f.prepare();f.setNow(q.expiresAt);await assert.rejects(f.confirm(q),invalid);
 const tokens=[await f.prepare(),await f.prepare(),await f.prepare()];await assert.rejects(f.confirm(tokens[0]),invalid);await f.confirm(tokens[1]);await f.confirm(tokens[2]);
 const g=fixture(),many=[];for(let i=0;i<33;i++)many.push(await g.prepare());await assert.rejects(g.confirm(many[0]),invalid);await g.confirm(many[1]);await g.confirm(many[32]);
});

test('invalid TTL and capacity configuration is rejected',()=>{
 for(const ttlMs of [0,-1,NaN,Infinity,-Infinity,'10',null])assert.throws(()=>fixture({ttlMs}),TypeError);
 for(const maxTokens of [0,-1,1.5,Infinity,NaN,Number.MAX_SAFE_INTEGER+1,'2',null])assert.throws(()=>fixture({maxTokens}),TypeError);
});

test('each binding mismatch burns its grant before execution',async()=>{
 for(const patch of [{sessionId:'other'},{repositoryId:'other'}]){const f=fixture(),p=await f.prepare();await assert.rejects(f.confirm(p,patch),invalid);await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,0);}
 for(const change of [f=>({...f.options,entry:{}}),f=>({...f.options,repository:{...f.options.repository}}),f=>({...f.options,cwd:'/other'})]){const f=fixture(),p=await f.prepare();await assert.rejects(f.confirm(p,{},change(f)),invalid);await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,0);}
});

test('invalidate is selective by entry identity and clear removes every remaining grant',async()=>{
 const f=fixture(),other={...f.options,entry:{}},p=await f.prepare(),q=await f.prepare({},other);f.host.invalidate({});f.host.invalidate(f.options.entry);await assert.rejects(f.confirm(p),invalid);await f.confirm(q,{},other);
 const r=await f.prepare(),s=await f.prepare({},other);f.host.clear();await assert.rejects(f.confirm(r),invalid);await assert.rejects(f.confirm(s,{},other),invalid);
});

test('prepare and pre-execution authorization/abort failures remain specific and do not execute',async()=>{
 const f=fixture(),denied=Object.assign(Error('denied'),{code:'vcs/not-authorized'}),bad={...f.options,assertAuthorized:async()=>{throw denied;}};
 await assert.rejects(f.prepare({},bad),error=>error===denied);
 const controller=new AbortController();controller.abort();const aborted={...f.options,signal:controller.signal};await assert.rejects(f.prepare({},aborted),{name:'AbortError'});
 for(const binding of [bad,aborted]){const p=await f.prepare();await assert.rejects(f.confirm(p,{},binding),binding===bad?error=>error===denied:{name:'AbortError'});await assert.rejects(f.confirm(p),invalid);acquireRepositoryAccess(f.options.repository.root,true)();}
 assert.equal(f.applied.length,0);
});

for(const code of ['vcs/stale','ABORT_ERR','vcs/not-authorized'])test('pre-start adapter '+code+' preserves identity and releases writer',async()=>{
 const failure=Object.assign(Error('private failure'),{code});let calls=0;
 const f=fixture({api:{applyLightweightTagCreate:async()=>{calls++;throw failure;}}}),p=await f.prepare();
 await assert.rejects(f.confirm(p),error=>error===failure);await assert.rejects(f.confirm(p),invalid);assert.equal(calls,1);acquireRepositoryAccess(f.options.repository.root,true)();
});

for(const kind of ['throw','abort','auth'])test('post-start '+kind+' normalizes unknown without disclosure retry or rollback',async()=>{
 let calls=0,checks=0;const failure=Object.assign(Error('sensitive'),{code:'vcs/stale'}),controller=new AbortController();
 const f=fixture({api:{applyLightweightTagCreate:async(repo,request)=>{calls++;request.onStart();if(kind==='throw')throw failure;if(kind==='abort')controller.abort();return {};}}}),p=await f.prepare();
 await assert.rejects(f.confirm(p,{},{...f.options,signal:controller.signal,assertAuthorized:async()=>{if(++checks===2&&kind==='auth')throw failure;}}),error=>{
  assert.equal(error.code,'vcs/lightweight-tag-create-outcome-unknown');assert.match(error.message,/inspect refs and HEAD/);assert.match(error.message,/Never retry automatically or roll back/);assert.equal(error.message.includes('sensitive'),false);return true;
 });
 await assert.rejects(f.confirm(p),invalid);assert.equal(calls,1);acquireRepositoryAccess(f.options.repository.root,true)();
});

function peer(kind,execute){
 const identity=person(),base={sessionId:'session',repositoryId:'repo'},snapshot={name:'other',head:'a'.repeat(40),ref:'refs/heads/main',objectFormat:'sha1',target:{oid:'a'.repeat(40)},commit:{oid:'b'.repeat(40)},object:{oid:'c'.repeat(40)},author:identity,committer:identity,tagger:identity,parents:[],message:'subject'};
 if(kind==='tag-create')return {host:createTagCreateCoordinator({api:{prepareTagCreate:async()=>snapshot,applyTagCreate:execute}}),address:{...base,name:'other',tagger:identity,message:'subject'}};
 if(kind==='branch-create')return {host:createBranchCreateCoordinator({api:{prepareBranchCreate:async()=>snapshot,applyBranchCreate:execute}}),address:{...base,name:'other'}};
 if(kind==='commit')return {host:createCommitCoordinator({api:{prepareCommitPreview:async()=>snapshot,applyCommitPreview:execute}}),address:{...base,author:identity,committer:identity,message:'subject'}};
 return {host:createAmendCoordinator({api:{prepareAmendPreview:async()=>snapshot,applyAmendPreview:execute}}),address:{...base,committer:identity,message:'subject'}};
}

for(const kind of ['tag-create','branch-create','commit','amend']){
 test('tokens cannot cross '+kind+' in either direction with identical bindings',async()=>{
  const f=fixture();let writes=0;const other=peer(kind,async()=>{writes++;return {};});const p=await f.prepare(),q=await other.host.prepare(other.address,f.options);
  await assert.rejects(other.host.confirm({...other.address,token:p.token},f.options),{code:'vcs/'+kind+'-confirmation-invalid'});await assert.rejects(f.confirm(q),invalid);assert.equal(writes,0);assert.equal(f.applied.length,0);
  await f.confirm(p);await other.host.confirm({...other.address,token:q.token},f.options);assert.equal(writes,1);assert.equal(f.applied.length,1);
 });
 for(const lightweightFirst of [true,false])test('shared '+kind+' writer exclusion both ways, lightweight first='+lightweightFirst,async()=>{
  let unlock,start,calls=0;const gate=new Promise(r=>{unlock=r;}),began=new Promise(r=>{start=r;});const execute=async(repo,request)=>{calls++;request.onStart();start();await gate;return {};};
  const f=fixture({api:{applyLightweightTagCreate:execute}}),other=peer(kind,execute),p=await f.prepare(),q=await other.host.prepare(other.address,f.options);
  const peerConfirm=()=>other.host.confirm({...other.address,token:q.token},f.options),pending=lightweightFirst?f.confirm(p):peerConfirm();await began;
  try{assert.throws(()=>acquireRepositoryAccess(f.options.repository.root),{code:'vcs/busy'});assert.throws(()=>acquireRepositoryAccess(f.options.repository.root,true),{code:'vcs/busy'});await assert.rejects(lightweightFirst?peerConfirm():f.confirm(p),{code:'vcs/busy'});}finally{unlock();await pending;}
  await assert.rejects(lightweightFirst?peerConfirm():f.confirm(p),{code:'vcs/'+(lightweightFirst?kind:'lightweight-tag-create')+'-confirmation-invalid'});assert.equal(calls,1);acquireRepositoryAccess(f.options.repository.root,true)();
 });
}

test('existing reader blocks lightweight writer, burns token and release permits a fresh operation',async()=>{
 const f=fixture(),p=await f.prepare(),release=acquireRepositoryAccess(f.options.repository.root);
 try{await assert.rejects(f.confirm(p),{code:'vcs/busy'});}finally{release();}
 await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,0);await f.confirm(await f.prepare());
});
