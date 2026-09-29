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
test('history cancellation during adapter work suppresses successful response',async()=>{
 const controller=new AbortController();const h=setup({listHistory:async()=>{controller.abort();return {};}});await h.discover();assert.equal((await h.call('vcs/history',payload,controller.signal)).error.code,'vcs/cancelled');
});
