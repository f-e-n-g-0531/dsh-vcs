import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommitCoordinator} from '../commit-host.mjs';
import {createIndexStageCoordinator} from '../index-stage-host.mjs';
import {createIndexUnstageCoordinator} from '../index-change-host.mjs';
import {createBranchSwitchCoordinator,acquireRepositoryAccess} from '../branch-switch-host.mjs';

const invalid={code:'vcs/commit-confirmation-invalid'};
const person=()=>({name:'Commit Author',email:'a@example.test',timestamp:123,timezone:'+0800'});
let id=0;
function fixture({api:overrides={},...config}={}){
 let now=100;
 const address={sessionId:'session',repositoryId:'repo',author:person(),committer:person(),message:'subject\n\nbody\n'};
 const snapshot={head:'a'.repeat(40),ref:'refs/heads/main',objectFormat:'sha1',indexDigest:'digest',tree:'b'.repeat(40),commit:{oid:'c'.repeat(40),body:Buffer.from('secret')},author:person(),committer:person(),message:address.message,rawIndex:Buffer.from('secret'),fingerprint:'secret'};
 const options={entry:{},repository:{type:'git',root:'/commit-host-'+ ++id},cwd:'/cwd',assertAuthorized:async()=>{}};
 const prepared=[],applied=[];
 const api={async prepareCommitPreview(repository,request){assert.equal(this,api);prepared.push({repository,request});return snapshot;},async applyCommitPreview(repository,request){assert.equal(this,api);applied.push({repository,request});request.onStart();return {head:snapshot.commit.oid};},...overrides};
 const host=createCommitCoordinator({api,now:()=>now,...config});
 return {host,address,snapshot,options,prepared,applied,setNow:value=>{now=value;},prepare:(extra={},binding=options)=>host.prepare({...address,...extra},binding),confirm:(p,extra={},binding=options)=>host.confirm({...address,...extra,token:p.token},binding)};
}
test('exact safe projection, private snapshot execution, single use and fixed action',async()=>{
 const f=fixture(),signal=new AbortController().signal,p=await f.prepare({},{...f.options,signal});
 assert.deepEqual(Object.keys(p).sort(),['action','head','ref','objectFormat','indexDigest','tree','commit','author','committer','message','token','expiresAt'].sort());
 assert.equal(p.action,'commit');assert.equal(p.expiresAt,60100);assert.match(p.token,/^[a-f0-9]{64}$/);
 assert.deepEqual(p.commit,{oid:f.snapshot.commit.oid});assert.equal(JSON.stringify(p).includes('secret'),false);
 assert.deepEqual(f.prepared[0].request,{author:f.address.author,committer:f.address.committer,message:f.address.message,signal});
 p.commit.oid='tamper';p.author.name='tamper';assert.equal(f.snapshot.author.name,'Commit Author');
 await f.confirm(p,{action:'stage',operationKind:'branch-switch',snapshot:{},message:'replace'},{...f.options,signal});
 const call=f.applied[0];assert.equal(call.request.snapshot,f.snapshot);assert.equal(call.request.signal,signal);assert.equal(call.request.assertAuthorized,f.options.assertAuthorized);
 assert.deepEqual(Object.keys(call.request).sort(),['snapshot','signal','assertAuthorized','onStart'].sort());
 await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,1);
});
test('TTL boundary and bounded oldest token eviction',async()=>{
 const f=fixture({ttlMs:10,maxTokens:2}),p=await f.prepare();f.setNow(109);await f.confirm(p);
 const q=await f.prepare();f.setNow(q.expiresAt);await assert.rejects(f.confirm(q),invalid);
 const tokens=[await f.prepare(),await f.prepare(),await f.prepare()];await assert.rejects(f.confirm(tokens[0]),invalid);await f.confirm(tokens[1]);await f.confirm(tokens[2]);
});
test('every authenticated binding mismatch burns the token',async()=>{
 for(const change of [{sessionId:'other'},{repositoryId:'other'}]){const f=fixture(),p=await f.prepare();await assert.rejects(f.confirm(p,change),invalid);await assert.rejects(f.confirm(p),invalid);}
 for(const change of [f=>({...f.options,entry:{}}),f=>({...f.options,repository:{...f.options.repository}}),f=>({...f.options,cwd:'/other'})]){const f=fixture(),p=await f.prepare();await assert.rejects(f.confirm(p,{},change(f)),invalid);await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,0);}
});
test('grant-specific invalidation and clear',async()=>{
 const f=fixture(),other={...f.options,entry:{}},p=await f.prepare(),q=await f.prepare({},other);f.host.invalidate(f.options.entry);await assert.rejects(f.confirm(p),invalid);await f.confirm(q,{},other);const r=await f.prepare();f.host.clear();await assert.rejects(f.confirm(r),invalid);
});
test('prepare and pre-start authorization or cancellation never execute; failed confirmations burn',async()=>{
 const f=fixture(),denied=Object.assign(Error('denied'),{code:'denied'}),bad={...f.options,assertAuthorized:async()=>{throw denied;}};
 await assert.rejects(f.prepare({},bad),e=>e===denied);
 const controller=new AbortController();controller.abort();const aborted={...f.options,signal:controller.signal};await assert.rejects(f.prepare({},aborted),{name:'AbortError'});
 for(const binding of [bad,aborted]){const p=await f.prepare();await assert.rejects(f.confirm(p,{},binding));await assert.rejects(f.confirm(p),invalid);}assert.equal(f.applied.length,0);
});
test('pre-start adapter failure stays specific; post-start failure, auth loss and abort are unknown without retry',async()=>{
 const failure=Object.assign(Error('sensitive'),{code:'vcs/stale'});
 const pre=fixture({api:{applyCommitPreview:async()=>{throw failure;}}}),p=await pre.prepare();await assert.rejects(pre.confirm(p),e=>e===failure);await assert.rejects(pre.confirm(p),invalid);
 for(const kind of ['throw','abort','auth']){
  let calls=0,checks=0;const controller=new AbortController();
  const f=fixture({api:{applyCommitPreview:async(repo,request)=>{calls++;request.onStart();if(kind==='throw')throw failure;if(kind==='abort')controller.abort();return {};}}}),q=await f.prepare();
  await assert.rejects(f.confirm(q,{},{...f.options,signal:controller.signal,assertAuthorized:async()=>{if(++checks===2&&kind==='auth')throw failure;}}),e=>{assert.equal(e.code,'vcs/commit-outcome-unknown');assert.match(e.message,/append-only/i);assert.match(e.message,/inspect HEAD and the index/);assert.match(e.message,/Never retry automatically or roll back/);assert.equal(e.message.includes('sensitive'),false);return true;});
  await assert.rejects(f.confirm(q),invalid);assert.equal(calls,1);acquireRepositoryAccess(f.options.repository.root,true)();
 }
});
function peer(kind,snapshot,execute){
 if(kind==='commit')return createCommitCoordinator({api:{prepareCommitPreview:async()=>snapshot,applyCommitPreview:execute}});
 if(kind==='stage')return createIndexStageCoordinator({api:{prepareIndexStage:async()=>({}),applyIndexStage:execute}});
 if(kind==='unstage')return createIndexUnstageCoordinator({api:{prepareIndexUnstage:async()=>({}),applyIndexUnstage:execute}});
 return createBranchSwitchCoordinator({api:{prepareLocalBranchSwitch:async()=>({}),switchLocalBranch:execute}});
}
test('tokens are isolated across stage, unstage, branch and commit instances in both directions',async()=>{
 for(const kind of ['stage','unstage','branch','commit']){
  const f=fixture();let writes=0;const other=peer(kind,f.snapshot,async()=>{writes++;return {};});const p=await f.prepare(),q=await other.prepare(f.address,f.options);
  await assert.rejects(other.confirm({...f.address,token:p.token},f.options));await assert.rejects(f.confirm(q),invalid);assert.equal(writes,0);
  await f.confirm(p);await other.confirm({...f.address,token:q.token},f.options);assert.equal(writes,1);
 }
});
test('shared writer excludes index and branch operations in either direction',async()=>{
 for(const kind of ['stage','unstage','branch'])for(const commitFirst of [true,false]){
  let unlock,start;const gate=new Promise(r=>{unlock=r;}),began=new Promise(r=>{start=r;});const execute=async(repo,request)=>{request.onStart();start();await gate;return {};};
  const f=fixture({api:{applyCommitPreview:execute}}),other=peer(kind,f.snapshot,execute),p=await f.prepare(),q=await other.prepare(f.address,f.options);
  const pending=commitFirst?f.confirm(p):other.confirm({...f.address,token:q.token},f.options);await began;
  try{assert.throws(()=>acquireRepositoryAccess(f.options.repository.root),{code:'vcs/busy'});await assert.rejects(commitFirst?other.confirm({...f.address,token:q.token},f.options):f.confirm(p),{code:'vcs/busy'});}finally{unlock();await pending;}
  await assert.rejects(commitFirst?other.confirm({...f.address,token:q.token},f.options):f.confirm(p));acquireRepositoryAccess(f.options.repository.root,true)();
 }
});
test('existing reader prevents commit and burns confirmation',async()=>{
 const f=fixture(),p=await f.prepare(),release=acquireRepositoryAccess(f.options.repository.root);try{await assert.rejects(f.confirm(p),{code:'vcs/busy'});}finally{release();}await assert.rejects(f.confirm(p),invalid);assert.equal(f.applied.length,0);
});
test('input is captured before awaits including identity records and session binding',async()=>{
 let resume;const gate=new Promise(r=>{resume=r;});let request;
 const f=fixture({api:{prepareCommitPreview:async(repo,value)=>{request=value;await gate;return {...f.snapshot,...value};}}});
 const original={...f.address,author:{...f.address.author},committer:{...f.address.committer}};const pending=f.host.prepare(f.address,f.options);
 f.address.author.name='mutated';f.address.committer.timestamp=999;f.address.message='mutated';f.address.sessionId='other';f.address.repositoryId='other';resume();const p=await pending;
 assert.deepEqual(request.author,original.author);assert.deepEqual(request.committer,original.committer);assert.equal(p.message,original.message);
 await f.host.confirm({...original,token:p.token},f.options);
});
test('strict own-data records reject getters, extras, prototypes and invalid scalar bounds before adapter',async()=>{
 const f=fixture();let getters=0;
 const getter=()=>{getters++;throw Error('getter invoked');};
 const badAddresses=[Object.create(f.address),{...f.address,extra:1},{...f.address,[Symbol('extra')]:1}];
 for(const key of ['author','committer','message','sessionId']){const value={...f.address};Object.defineProperty(value,key,{get:getter,enumerable:true});badAddresses.push(value);}
 for(const who of ['author','committer']){
  for(const key of ['name','email','timestamp','timezone']){const value={...f.address,[who]:person()};Object.defineProperty(value[who],key,{get:getter,enumerable:true});badAddresses.push(value);}
  badAddresses.push({...f.address,[who]:{...person(),extra:1}},{...f.address,[who]:Object.create(person())});
  for(const patch of [{name:Buffer.from('name')},{name:'x'.repeat(1025)},{email:'bad<>email'},{timestamp:-1},{timestamp:Infinity},{timezone:'+1401'},{timezone:'+0060'}])badAddresses.push({...f.address,[who]:{...person(),...patch}});
 }
 for(const message of [Buffer.from('message'),'', ' ', 'a'.repeat(65537),'bad\0','bad\r','bad\u2028','bad\ud800'])badAddresses.push({...f.address,message});
 for(const address of badAddresses)await assert.rejects(f.host.prepare(address,f.options),invalid);
 assert.equal(getters,0);assert.equal(f.prepared.length,0);
});
test('null-prototype records and exact valid scalar boundaries remain accepted',async()=>{
 const f=fixture();const address=Object.assign(Object.create(null),f.address,{author:Object.assign(Object.create(null),person(),{name:'x'.repeat(1024),timestamp:Number.MAX_SAFE_INTEGER,timezone:'-1400'}),message:'x'.repeat(65536)});
 const p=await f.host.prepare(address,f.options);await f.host.confirm({...f.address,token:p.token},f.options);
});
