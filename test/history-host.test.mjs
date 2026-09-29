import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../index.mjs';
const repo={id:'git-one',type:'git',root:'/workspace'};
const payload={sessionId:'s',repositoryId:repo.id};
function setup(overrides={}){
 let cwd='/workspace',clock=0,calls=0;
 const ctx={sessions:{get:()=>({header:{cwd}})},sessionPersistence:{stat:async()=>undefined}};
 const api={discoverRepositories:async()=>({repositories:[repo],warnings:[]}),listHistory:async(r,o)=>{calls++;assert.deepEqual(r,repo);return {snapshot:'a'.repeat(40),commits:[],nextOffset:null};},...overrides};
 const call=createHandler(ctx,api,4,{now:()=>clock});
 return {call,discover:()=>call('vcs/repositories',{sessionId:'s'}),move:()=>{cwd='/other';},expire:()=>{clock=300001;},calls:()=>calls};
}
for(const [endpoint,method] of [['vcs/revision-changes','getRevisionChanges'],['vcs/revision-compare','getRevisionComparison']]){
 test(endpoint+' enforces grants strict fields and forwards immutable versions',async()=>{
  const controller=new AbortController();let count=0;
  const p={...payload,base:'a'.repeat(40),target:'b'.repeat(40),...(endpoint.endsWith('compare')?{id:'c'.repeat(64)}:{})};
  const h=setup({[method]:async(r,o)=>{count++;assert.deepEqual(r,repo);assert.equal(o.base,p.base);assert.equal(o.target,p.target);assert.equal(o.signal,controller.signal);if(p.id)assert.equal(o.id,p.id);return {changes:[]};}});
  assert.equal((await h.call(endpoint,p)).error.code,'vcs/rediscover-required');await h.discover();
  for(const extra of [{root:'/evil'},{path:'file'},{mode:'all'},{base:'HEAD'},{target:null},{target:'--all'},{base:undefined},...(p.id?[{id:'forged'}]:[{id:'c'.repeat(64)}])])assert.equal((await h.call(endpoint,{...p,...extra})).error.code,'vcs/invalid-request');
  assert.equal(count,0);assert.equal((await h.call(endpoint,{...p,sessionId:'foreign'})).error.code,'vcs/rediscover-required');
  assert.equal((await h.call(endpoint,p,controller.signal)).ok,true);assert.equal(count,1);
  h.expire();assert.equal((await h.call(endpoint,p)).error.code,'vcs/rediscover-required');
 });
 test(endpoint+' discards cwd-stale and cancelled results',async()=>{
  const p={...payload,base:'a'.repeat(40),target:'b'.repeat(40),...(endpoint.endsWith('compare')?{id:'c'.repeat(64)}:{})};
  const h=setup({[method]:async()=>{h.move();return {};}});await h.discover();assert.equal((await h.call(endpoint,p)).error.code,'vcs/rediscover-required');
  const controller=new AbortController(),cancel=setup({[method]:async()=>{controller.abort();return {};}});await cancel.discover();assert.equal((await cancel.call(endpoint,p,controller.signal)).error.code,'vcs/cancelled');
 });
}
test('history requires per-session grants and rejects roots and invalid arguments',async()=>{
 const h=setup();assert.equal((await h.call('vcs/history',payload)).error.code,'vcs/rediscover-required');await h.discover();
 for(const extra of [{root:'/evil'},{mode:'all'},{snapshot:'--all'},{offset:-1},{limit:101},{offset:0.5},{offset:null},{limit:null}])assert.equal((await h.call('vcs/history',{...payload,...extra})).error.code,'vcs/invalid-request');
 for(const extra of [{sessionId:'foreign'},{repositoryId:'foreign'}])assert.equal((await h.call('vcs/history',{...payload,...extra})).error.code,'vcs/rediscover-required');
 assert.equal(h.calls(),0);assert.equal((await h.call('vcs/history',payload)).ok,true);h.expire();assert.equal((await h.call('vcs/history',payload)).error.code,'vcs/rediscover-required');
});
test('history forwards bounded options and signal and discards cwd-stale results',async()=>{
 const controller=new AbortController();let h;
 h=setup({listHistory:async(r,o)=>{assert.equal(o.signal,controller.signal);assert.equal(o.limit,50);assert.equal(o.offset,0);h.move();return {};}});
 await h.discover();assert.equal((await h.call('vcs/history',payload,controller.signal)).error.code,'vcs/rediscover-required');
 controller.abort();assert.equal((await h.call('vcs/history',payload,controller.signal)).error.code,'vcs/cancelled');
});
test('commit details enforce grants, fields and forward selected parent',async()=>{
 const id='a'.repeat(40),controller=new AbortController();let count=0;
 const h=setup({getCommitDetails:async(r,o)=>{count++;assert.deepEqual(r,repo);assert.deepEqual(o,{commit:id,parentIndex:1,signal:controller.signal});return {id};}});
 const p={...payload,commit:id,parentIndex:1};
 assert.equal((await h.call('vcs/commit',p)).error.code,'vcs/rediscover-required');await h.discover();
 for(const extra of [{commit:'HEAD'},{parentIndex:null},{parentIndex:-1},{root:'/evil'},{mode:'all'}])assert.equal((await h.call('vcs/commit',{...p,...extra})).error.code,'vcs/invalid-request');
 assert.equal(count,0);assert.equal((await h.call('vcs/commit',p,controller.signal)).value.id,id);assert.equal(count,1);
 h.move();assert.equal((await h.call('vcs/commit',p)).error.code,'vcs/rediscover-required');
});
test('historical comparison requires grants and opaque ID and forwards cancellation',async()=>{
 const commit='a'.repeat(40),id='b'.repeat(64),controller=new AbortController();let count=0;
 const h=setup({getCommitComparison:async(r,o)=>{count++;assert.deepEqual(r,repo);assert.deepEqual(o,{commit,id,parentIndex:0,signal:controller.signal});return {path:'file'};}});
 const p={...payload,commit,id};
 assert.equal((await h.call('vcs/commit-compare',p)).error.code,'vcs/rediscover-required');await h.discover();
 for(const extra of [{id:'../file'},{path:'secret'},{commit:'HEAD'},{parentIndex:null}])assert.equal((await h.call('vcs/commit-compare',{...p,...extra})).error.code,'vcs/invalid-request');
 assert.equal(count,0);assert.equal((await h.call('vcs/commit-compare',p,controller.signal)).value.path,'file');assert.equal(count,1);
 h.expire();assert.equal((await h.call('vcs/commit-compare',p)).error.code,'vcs/rediscover-required');
});
test('history cancellation during adapter work suppresses successful response',async()=>{
 const controller=new AbortController();const h=setup({listHistory:async()=>{controller.abort();return {};}});await h.discover();assert.equal((await h.call('vcs/history',payload,controller.signal)).error.code,'vcs/cancelled');
});
