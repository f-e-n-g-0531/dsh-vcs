import test from 'node:test';
import assert from 'node:assert/strict';
import {createTagCreateCoordinator} from '../tag-create-host.mjs';
import {createBranchCreateCoordinator} from '../branch-create-host.mjs';
import {createCommitCoordinator} from '../commit-host.mjs';
import {createAmendCoordinator} from '../amend-host.mjs';
import {acquireRepositoryAccess} from '../confirmed-operation.mjs';

const invalid={code:'vcs/tag-create-confirmation-invalid'};
const person=()=>({name:'Tag Author',email:'tag@example.test',timestamp:123,timezone:'+0800'});
let id=0;
function fixture({api:overrides={},...config}={}){
 let now=100;
 const address={sessionId:'session',repositoryId:'repo',name:'release/v1',tagger:person(),message:'Release\n\nNotes\r\n'};
 const snapshot={action:'untrusted',name:address.name,ref:'refs/tags/'+address.name,objectFormat:'sha1',head:'a'.repeat(40),currentRef:'refs/heads/main',targetTree:'b'.repeat(40),tagger:{...person(),private:'secret'},message:address.message,messageBytes:Buffer.byteLength(address.message),object:{oid:'c'.repeat(40),body:Buffer.from('secret')},planId:'private-plan-id',raw:Buffer.from('secret'),fingerprint:'secret'};
 const options={entry:{},repository:{type:'git',root:'/tag-create-host-'+ ++id,private:'secret'},cwd:'/cwd',assertAuthorized:async()=>{}};
 const prepared=[],applied=[];
 const api={async prepareTagCreate(repository,request){assert.equal(this,api);prepared.push({repository,request});return snapshot;},async applyTagCreate(repository,request){assert.equal(this,api);applied.push({repository,request});request.onStart();return {ref:snapshot.ref};},...overrides};
 const host=createTagCreateCoordinator({api,now:()=>now,...config});
 return {host,address,snapshot,options,prepared,applied,setNow:value=>{now=value;},prepare:(extra={},binding=options)=>host.prepare({...address,...extra},binding),confirm:(p,extra={},binding=options)=>host.confirm({...address,...extra,token:p.token},binding)};
}

test('explicit safe public projection copies tagger/object and retains exact private snapshot',async()=>{
 const f=fixture(),signal=new AbortController().signal,p=await f.prepare({},{...f.options,signal});
 assert.deepEqual(p,{action:'tag-create',name:f.snapshot.name,ref:f.snapshot.ref,objectFormat:'sha1',head:f.snapshot.head,currentRef:f.snapshot.currentRef,targetTree:f.snapshot.targetTree,tagger:person(),message:f.snapshot.message,messageBytes:f.snapshot.messageBytes,object:{oid:f.snapshot.object.oid},planId:f.snapshot.planId,token:p.token,expiresAt:60100});
 assert.match(p.token,/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(p).includes('secret'),false);
 const noBuffers=value=>{assert.equal(Buffer.isBuffer(value),false);if(value&&typeof value==='object')for(const child of Object.values(value))noBuffers(child);};noBuffers(p);
 assert.deepEqual(f.prepared[0].repository,{type:'git',root:f.options.repository.root});
 assert.deepEqual({...f.prepared[0].request,tagger:{...f.prepared[0].request.tagger}},{name:f.address.name,tagger:person(),message:f.address.message,signal});
 assert.notEqual(p.tagger,f.snapshot.tagger);assert.notEqual(p.object,f.snapshot.object);
 p.tagger.name='tamper';p.object.oid='tamper';p.name='tamper';p.ref='tamper';p.planId='tamper';
 assert.equal(f.snapshot.tagger.name,person().name);assert.equal(f.snapshot.object.oid,'c'.repeat(40));
 const result=await f.confirm(p,{action:'commit',operationKind:'amend',name:'other',tagger:{},object:{oid:'tamper'},snapshot:{},planId:'tamper'},{...f.options,signal});
 assert.deepEqual(result,{ref:f.snapshot.ref});
 const call=f.applied[0];assert.deepEqual(call.repository,{type:'git',root:f.options.repository.root});assert.equal(call.request.snapshot,f.snapshot);assert.equal(call.request.signal,signal);assert.equal(call.request.assertAuthorized,f.options.assertAuthorized);
 assert.deepEqual(Object.keys(call.request).sort(),['snapshot','signal','assertAuthorized','onStart'].sort());
 await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,1);
});

test('TTL expiry boundary and custom/default oldest-token capacity',async()=>{
 const f=fixture({ttlMs:10,maxTokens:2}),p=await f.prepare();f.setNow(109);await f.confirm(p);
 const q=await f.prepare();f.setNow(q.expiresAt);await assert.rejects(f.confirm(q),invalid);
 const tokens=[await f.prepare(),await f.prepare(),await f.prepare()];await assert.rejects(f.confirm(tokens[0]),invalid);await f.confirm(tokens[1]);await f.confirm(tokens[2]);
 const g=fixture(),many=[];for(let i=0;i<33;i++)many.push(await g.prepare());await assert.rejects(g.confirm(many[0]),invalid);await g.confirm(many[1]);await g.confirm(many[32]);
});

test('invalid TTL/capacity configuration is rejected',()=>{
 for(const config of [{ttlMs:0},{ttlMs:-1},{ttlMs:NaN},{ttlMs:Infinity},{maxTokens:0},{maxTokens:-1},{maxTokens:1.5},{maxTokens:Infinity}])assert.throws(()=>fixture(config),TypeError);
});

test('every authenticated binding mismatch burns token before any execution',async()=>{
 for(const patch of [{sessionId:'other'},{repositoryId:'other'}]){const f=fixture(),p=await f.prepare();await assert.rejects(f.confirm(p,patch),invalid);await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,0);}
 for(const change of [f=>({...f.options,entry:{}}),f=>({...f.options,repository:{...f.options.repository}}),f=>({...f.options,cwd:'/other'})]){const f=fixture(),p=await f.prepare();await assert.rejects(f.confirm(p,{},change(f)),invalid);await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,0);}
});

test('grant invalidation is selective and clear invalidates all remaining grants',async()=>{
 const f=fixture(),other={...f.options,entry:{}},p=await f.prepare(),q=await f.prepare({},other);f.host.invalidate({});f.host.invalidate(f.options.entry);await assert.rejects(f.confirm(p),invalid);await f.confirm(q,{},other);
 const r=await f.prepare(),s=await f.prepare({},other);f.host.clear();await assert.rejects(f.confirm(r),invalid);await assert.rejects(f.confirm(s,{},other),invalid);
});

test('all required address/tagger fields are owned and present; accessors and extras never run',async()=>{
 const f=fixture();let getters=0;const getter=()=>{getters++;throw Error('getter invoked');};
 const bad=[null,[],42,'tag',Object.create(f.address),{...f.address,extra:1},{...f.address,[Symbol('extra')]:1}];
 for(const key of ['sessionId','repositoryId','name','tagger','message']){
  const missing={...f.address};delete missing[key];bad.push(missing);
  const accessor={...f.address};Object.defineProperty(accessor,key,{get:getter,enumerable:true});bad.push(accessor);
 }
 for(const key of ['name','email','timestamp','timezone']){
  const tagger=person();delete tagger[key];bad.push({...f.address,tagger});
  const accessor=person();Object.defineProperty(accessor,key,{get:getter,enumerable:false});bad.push({...f.address,tagger:accessor});
 }
 for(const tagger of [null,[],42,Object.create(person()),{...person(),extra:1},{...person(),[Symbol('extra')]:1}])bad.push({...f.address,tagger});
 for(const key of ['oid','ref','object','target','snapshot','token','operationKind','root','planId'])bad.push({...f.address,[key]:'not allowed'});
 const hidden={...f.address};Object.defineProperty(hidden,'hidden',{value:1});bad.push(hidden);
 for(const value of bad)await assert.rejects(f.host.prepare(value,f.options),invalid);
 assert.equal(getters,0);assert.equal(f.prepared.length,0);
});

test('strict scalar metadata rejects invalid identities/messages/names before adapter or authorization',async()=>{
 const f=fixture();let checks=0;const binding={...f.options,assertAuthorized:async()=>{checks++;}};
 const bad=[];
 for(const key of ['sessionId','repositoryId'])for(const value of ['',null,1,{},undefined])bad.push({...f.address,[key]:value});
 for(const patch of [{name:''},{name:Buffer.from('name')},{name:'x'.repeat(1025)},{name:'bad\nname'},{email:'bad<>email'},{timestamp:-1},{timestamp:Infinity},{timestamp:1.5},{timestamp:'123'},{timezone:'+1401'},{timezone:'+0060'}])bad.push({...f.address,tagger:{...person(),...patch}});
 for(const message of [undefined,null,Buffer.from('message'),'', ' ', 'a'.repeat(65537),'中'.repeat(21846),'bad\x00','bad\u0085','bad\ud800','prefix-----BEGIN PGP SIGNATURE-----suffix'])bad.push({...f.address,message});
 for(const name of ['',null,1,'@','HEAD','-tag','refs/tags/a','a//b','.a','a.lock','CON','a..b','a@{b','a b','a\u200db','\ud800','a'.repeat(256),'中'.repeat(86),Array(4).fill('a'.repeat(250)).join('/')])bad.push({...f.address,name});
 for(const address of bad)await assert.rejects(f.host.prepare(address,binding),invalid);
 assert.equal(f.prepared.length,0);assert.equal(checks,0);
});

test('null-prototype own records and valid boundary metadata are accepted unchanged',async()=>{
 const f=fixture();const address=Object.assign(Object.create(null),f.address,{name:'é'.repeat(127)+'a',tagger:Object.assign(Object.create(null),person(),{name:'x'.repeat(1024),timestamp:Number.MAX_SAFE_INTEGER,timezone:'-1400'}),message:'x'.repeat(65536)});
 const p=await f.host.prepare(address,f.options);assert.equal(f.prepared[0].request.message,address.message);await f.host.confirm({sessionId:address.sessionId,repositoryId:address.repositoryId,token:p.token},f.options);
 for(const message of ['\uFEFFRelease\r\n\tNotes','正文\n','x'.repeat(65535)+'\n'])await f.prepare({message});
});

test('input scalars, tagger and session/repository IDs are captured before adapter await',async()=>{
 let resume,request;const gate=new Promise(r=>{resume=r;});
 const f=fixture({api:{prepareTagCreate:async(repo,value)=>{request=value;await gate;return {...f.snapshot,name:value.name,tagger:value.tagger,message:value.message};}}});
 const original={...f.address,tagger:{...f.address.tagger}},pending=f.host.prepare(f.address,f.options);
 f.address.tagger.name='changed';f.address.tagger.timestamp=999;f.address.tagger=person();f.address.name='other';f.address.message='changed';f.address.sessionId='other';f.address.repositoryId='other';
 resume();const p=await pending;
 assert.deepEqual({...request.tagger},original.tagger);assert.equal(Object.isFrozen(request.tagger),true);assert.equal(request.name,original.name);assert.equal(request.message,original.message);assert.equal(p.name,original.name);
 await f.host.confirm({...original,token:p.token},f.options);
});

test('authorization-time input mutation cannot change captured metadata or token binding',async()=>{
 const f=fixture(),original={...f.address,tagger:{...f.address.tagger}};
 const binding={...f.options,assertAuthorized:async()=>{f.address.tagger.email='other@example.test';f.address.message='changed';f.address.name='other';f.address.sessionId='other';f.address.repositoryId='other';}};
 const p=await f.host.prepare(f.address,binding);assert.deepEqual({...f.prepared[0].request.tagger},original.tagger);assert.equal(f.prepared[0].request.message,original.message);
 await f.host.confirm({...original,token:p.token},f.options);
});

test('prepare and pre-execution authorization/abort failures remain specific without execution',async()=>{
 const f=fixture(),denied=Object.assign(Error('denied'),{code:'vcs/not-authorized'}),bad={...f.options,assertAuthorized:async()=>{throw denied;}};
 await assert.rejects(f.prepare({},bad),error=>error===denied);
 const controller=new AbortController();controller.abort();const aborted={...f.options,signal:controller.signal};await assert.rejects(f.prepare({},aborted),{name:'AbortError'});
 for(const binding of [bad,aborted]){const p=await f.prepare();await assert.rejects(f.confirm(p,{},binding),binding===bad?error=>error===denied:{name:'AbortError'});await assert.rejects(f.confirm(p),invalid);acquireRepositoryAccess(f.options.repository.root,true)();}
 assert.equal(f.applied.length,0);
});

for(const code of ['vcs/stale','ABORT_ERR','vcs/not-authorized'])test('pre-start adapter '+code+' retains exact error and burns token',async()=>{
 const failure=Object.assign(Error('before publication'),{code});let calls=0;
 const f=fixture({api:{applyTagCreate:async()=>{calls++;throw failure;}}}),p=await f.prepare();
 await assert.rejects(f.confirm(p),error=>error===failure);await assert.rejects(f.confirm(p),invalid);assert.equal(calls,1);acquireRepositoryAccess(f.options.repository.root,true)();
});

for(const kind of ['throw','abort','auth'])test('post-start '+kind+' is unknown without disclosure/retry/rollback',async()=>{
 let calls=0,checks=0;const failure=Object.assign(Error('sensitive'),{code:'vcs/stale'}),controller=new AbortController();
 const f=fixture({api:{applyTagCreate:async(repo,request)=>{calls++;request.onStart();if(kind==='throw')throw failure;if(kind==='abort')controller.abort();return {};}}}),p=await f.prepare();
 await assert.rejects(f.confirm(p,{},{...f.options,signal:controller.signal,assertAuthorized:async()=>{if(++checks===2&&kind==='auth')throw failure;}}),error=>{
  assert.equal(error.code,'vcs/tag-create-outcome-unknown');assert.match(error.message,/Objects or refs may exist/);assert.match(error.message,/inspect refs and HEAD/);assert.match(error.message,/Never retry automatically, delete objects or refs, or roll back/);assert.equal(error.message.includes('sensitive'),false);return true;
 });
 await assert.rejects(f.confirm(p),invalid);assert.equal(calls,1);acquireRepositoryAccess(f.options.repository.root,true)();
});

function peer(kind,execute){
 const identity=person(),snapshot={head:'a'.repeat(40),ref:'refs/heads/main',objectFormat:'sha1',target:{oid:'a'.repeat(40)},commit:{oid:'b'.repeat(40)},author:identity,committer:identity,parents:[],message:'subject'};
 if(kind==='branch-create')return {host:createBranchCreateCoordinator({api:{prepareBranchCreate:async()=>snapshot,applyBranchCreate:execute}}),address:{sessionId:'session',repositoryId:'repo',name:'other'}};
 if(kind==='commit')return {host:createCommitCoordinator({api:{prepareCommitPreview:async()=>snapshot,applyCommitPreview:execute}}),address:{sessionId:'session',repositoryId:'repo',author:identity,committer:identity,message:'subject'}};
 return {host:createAmendCoordinator({api:{prepareAmendPreview:async()=>snapshot,applyAmendPreview:execute}}),address:{sessionId:'session',repositoryId:'repo',committer:identity,message:'subject'}};
}
for(const kind of ['branch-create','commit','amend']){
 test('tokens cannot cross '+kind+' coordinators in either direction despite identical bindings',async()=>{
  const f=fixture();let writes=0;const other=peer(kind,async()=>{writes++;return {};});const p=await f.prepare(),q=await other.host.prepare(other.address,f.options);
  await assert.rejects(other.host.confirm({...other.address,token:p.token},f.options),{code:'vcs/'+kind+'-confirmation-invalid'});await assert.rejects(f.confirm(q),invalid);assert.equal(writes,0);assert.equal(f.applied.length,0);
  await f.confirm(p);await other.host.confirm({...other.address,token:q.token},f.options);assert.equal(writes,1);
 });
 for(const tagFirst of [true,false])test('shared '+kind+' writer excludes both readers/writers, tag first='+tagFirst,async()=>{
  let unlock,start,calls=0;const gate=new Promise(r=>{unlock=r;}),began=new Promise(r=>{start=r;});const execute=async(repo,request)=>{calls++;request.onStart();start();await gate;return {};};
  const f=fixture({api:{applyTagCreate:execute}}),other=peer(kind,execute),p=await f.prepare(),q=await other.host.prepare(other.address,f.options);
  const peerConfirm=()=>other.host.confirm({...other.address,token:q.token},f.options),pending=tagFirst?f.confirm(p):peerConfirm();await began;
  try{assert.throws(()=>acquireRepositoryAccess(f.options.repository.root),{code:'vcs/busy'});assert.throws(()=>acquireRepositoryAccess(f.options.repository.root,true),{code:'vcs/busy'});await assert.rejects(tagFirst?peerConfirm():f.confirm(p),{code:'vcs/busy'});}finally{unlock();await pending;}
  await assert.rejects(tagFirst?peerConfirm():f.confirm(p),{code:'vcs/'+(tagFirst?kind:'tag-create')+'-confirmation-invalid'});assert.equal(calls,1);acquireRepositoryAccess(f.options.repository.root,true)();
 });
}

test('existing reader blocks tag writer, burns token, and release restores operation',async()=>{
 const f=fixture(),p=await f.prepare(),release=acquireRepositoryAccess(f.options.repository.root);
 try{await assert.rejects(f.confirm(p),{code:'vcs/busy'});}finally{release();}
 await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,0);await f.confirm(await f.prepare());
});
