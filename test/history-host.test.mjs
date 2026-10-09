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
test('heavy segment admission leaves history available and recovers after failure',async()=>{
 let finish,entered;const ready=new Promise(r=>entered=r),h=setup({getHistoricalSegment:async()=>{entered();return new Promise((_r,reject)=>finish=()=>reject(Error('read failed')));},listHistory:async()=>({commits:[]})});await h.discover();const p={...payload,commit:'a'.repeat(40),path:'file.txt'},first=h.call('vcs/tree-segment',p);await ready;assert.equal((await h.call('vcs/tree-segment',p)).error.code,'vcs/busy');assert.equal((await h.call('vcs/history',payload)).ok,true);finish();assert.equal((await first).ok,false);const second=h.call('vcs/tree-segment',p);await new Promise(r=>setImmediate(r));finish();assert.equal((await second).error.code,'vcs/operation-failed');
});
test('historical segment RPC strictly binds committed path offset and Session grant',async()=>{
 let seen;const h=setup({getHistoricalSegment:async(_r,o)=>{seen=o;return {text:'part'};}}),p={...payload,commit:'a'.repeat(40),path:'file.txt',offset:65536};assert.equal((await h.call('vcs/tree-segment',p)).error.code,'vcs/rediscover-required');await h.discover();
 for(const extra of [{offset:null},{offset:-1},{offset:16777217},{offset:0.5},{oid:'b'.repeat(40)},{limit:10},{path:'../secret'},{commit:'HEAD'}])assert.equal((await h.call('vcs/tree-segment',{...p,...extra})).error.code,'vcs/invalid-request');assert.equal(seen,undefined);assert.equal((await h.call('vcs/tree-segment',p)).ok,true);assert.equal(seen.offset,65536);
 const moved=setup({getHistoricalSegment:async()=>{moved.move();return {};}});await moved.discover();assert.equal((await moved.call('vcs/tree-segment',p)).error.code,'vcs/rediscover-required');const controller=new AbortController(),cancel=setup({getHistoricalSegment:async()=>{controller.abort();return {};}});await cancel.discover();assert.equal((await cancel.call('vcs/tree-segment',p,controller.signal)).error.code,'vcs/cancelled');
});
test('workspace image is Git granted opaque selected mode with strict side fields',async()=>{
 let seen;const h=setup({getWorkspaceImage:async(_r,o)=>{seen=o;return {absent:true};}}),p={...payload,mode:'unstaged',id:'a'.repeat(64)};
 assert.equal((await h.call('vcs/workspace-image',p)).error.code,'vcs/rediscover-required');await h.discover();
 for(const extra of [{id:null},{id:'x'},{mode:'wrong'},{side:'both'},{path:'secret'},{base:'a'.repeat(40)},{url:'file:///secret'}])assert.equal((await h.call('vcs/workspace-image',{...p,...extra})).error.code,'vcs/invalid-request');assert.equal(seen,undefined);
 assert.equal((await h.call('vcs/workspace-image',p)).ok,true);assert.equal(seen.mode,'unstaged');assert.equal(seen.side,'right');h.expire();assert.equal((await h.call('vcs/workspace-image',p)).error.code,'vcs/rediscover-required');
});
test('commit and revision image requests share two slots and recover after failure',async()=>{
 let ready;const both=new Promise(resolve=>ready=resolve),finish=[];
 const read=async()=>{const promise=new Promise((resolve,reject)=>finish.push({resolve,reject}));if(finish.length===2)ready();return promise;};
 const h=setup({getCommitImage:read,getRevisionImage:read});await h.discover();const commit={...payload,commit:'a'.repeat(40),id:'b'.repeat(64)},pair={...payload,base:'a'.repeat(40),target:'c'.repeat(40),id:'d'.repeat(64)};
 const one=h.call('vcs/commit-image',commit),two=h.call('vcs/revision-image',pair);await both;assert.equal((await h.call('vcs/revision-image',pair)).error.code,'vcs/busy');assert.equal((await h.call('vcs/commit-image',commit)).error.code,'vcs/busy');
 finish[0].reject(Error('failed'));finish[1].resolve({absent:true});assert.equal((await one).ok,false);assert.equal((await two).ok,true);
 const next=h.call('vcs/revision-image',pair);while(finish.length<3)await new Promise(resolve=>setImmediate(resolve));finish[2].resolve({absent:true});assert.equal((await next).ok,true);
});
test('revision image requires fixed pair grants strict side and shares image slots',async()=>{
 const p={...payload,base:'a'.repeat(40),target:'b'.repeat(40),id:'c'.repeat(64)};let seen;
 const h=setup({getRevisionImage:async(_r,o)=>{seen=o;return {absent:true};}});assert.equal((await h.call('vcs/revision-image',p)).error.code,'vcs/rediscover-required');await h.discover();
 for(const extra of [{side:'bad'},{base:'HEAD'},{id:'no'},{path:'secret'},{root:'/evil'},{commit:'a'.repeat(40)}])assert.equal((await h.call('vcs/revision-image',{...p,...extra})).error.code,'vcs/invalid-request');assert.equal(seen,undefined);assert.equal((await h.call('vcs/revision-image',p)).ok,true);assert.equal(seen.side,'right');assert.equal(seen.base,p.base);
 const controller=new AbortController(),moved=setup({getRevisionImage:async()=>{moved.move();return {};}});await moved.discover();assert.equal((await moved.call('vcs/revision-image',p)).error.code,'vcs/rediscover-required');controller.abort();assert.equal((await h.call('vcs/revision-image',p,controller.signal)).error.code,'vcs/cancelled');
});
test('Blame line window validates bounds and forwards only authorized selection',async()=>{
 let received;const p={...payload,commit:'a'.repeat(40),id:'b'.repeat(64),startLine:501,lineLimit:100};const h=setup({getFileBlame:async(_r,o)=>{received=o;return {lines:[]};}});await h.discover();
 for(const fields of [{startLine:null},{startLine:0},{startLine:100002},{startLine:1.5},{lineLimit:501},{lineLimit:0},{lineLimit:null},{path:'secret'}])assert.equal((await h.call('vcs/blame',{...p,...fields})).error.code,'vcs/invalid-request');assert.equal(received,undefined);assert.equal((await h.call('vcs/blame',p)).ok,true);assert.equal(received.startLine,501);assert.equal(received.lineLimit,100);
});
test('file history follow is boolean authorized and forwards unchanged cancellation',async()=>{
 const p={...payload,commit:'a'.repeat(40),id:'b'.repeat(64),follow:true};let received;
 const h=setup({listFileHistory:async(_r,o)=>{received=o;return {commits:[]};}});assert.equal((await h.call('vcs/file-history',p)).error.code,'vcs/rediscover-required');await h.discover();
 for(const follow of [null,1,'true',{},[]])assert.equal((await h.call('vcs/file-history',{...p,follow})).error.code,'vcs/invalid-request');assert.equal(received,undefined);
 const controller=new AbortController();assert.equal((await h.call('vcs/file-history',p,controller.signal)).ok,true);assert.equal(received.follow,true);assert.equal(received.signal,controller.signal);
 const moved=setup({listFileHistory:async()=>{moved.move();return {};}});await moved.discover();assert.equal((await moved.call('vcs/file-history',p)).error.code,'vcs/rediscover-required');
});
test('history search validates strict query fields and forwards literal search under grants',async()=>{
 const search={message:'--all .*',author:'作者',path:':(glob)*.txt'};let received;
 const h=setup({listHistory:async(_r,o)=>{received=o;return {commits:[]};}});await h.discover();
 for(const search of [null,[],{url:'https://example.com'},{path:'../escape'},{message:'x'.repeat(1025)},{author:4}])assert.equal((await h.call('vcs/history',{...payload,search})).error.code,'vcs/invalid-request');
 assert.equal(received,undefined);assert.equal((await h.call('vcs/history',{...payload,search})).ok,true);assert.deepEqual(received.search,search);
});
test('references RPC requires grants rejects options and discards stale results',async()=>{
 const controller=new AbortController();let calls=0;
 const h=setup({listReferences:async(r,o)=>{calls++;assert.deepEqual(r,repo);assert.deepEqual(o,{signal:controller.signal});return {references:[]};}});
 assert.equal((await h.call('vcs/references',payload)).error.code,'vcs/rediscover-required');await h.discover();
 for(const extra of [{path:'secret'},{prefix:'refs/remotes/'},{url:'https://example.com'},{limit:1},{commit:'a'.repeat(40)},{mode:'all'}])assert.equal((await h.call('vcs/references',{...payload,...extra})).error.code,'vcs/invalid-request');
 assert.equal(calls,0);assert.equal((await h.call('vcs/references',{...payload,sessionId:'foreign'})).error.code,'vcs/rediscover-required');assert.deepEqual((await h.call('vcs/references',payload,controller.signal)).value,{references:[]});
 h.expire();assert.equal((await h.call('vcs/references',payload)).error.code,'vcs/rediscover-required');
 const moved=setup({listReferences:async()=>{moved.move();return {};}});await moved.discover();assert.equal((await moved.call('vcs/references',payload)).error.code,'vcs/rediscover-required');
 const cancel=setup({listReferences:async()=>{controller.abort();return {};}});await cancel.discover();assert.equal((await cancel.call('vcs/references',payload,controller.signal)).error.code,'vcs/cancelled');
 const svn=setup({discoverRepositories:async()=>({repositories:[{...repo,type:'svn'}],warnings:[]}),listReferences:async()=>{throw Error('Must not call');}});await svn.discover();assert.equal((await svn.call('vcs/references',payload)).error.code,'vcs/invalid-request');
});
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
test('historical file enforces path grants and rejects stale results',async()=>{
 const p={...payload,commit:'a'.repeat(40),path:'nested/file.txt'},controller=new AbortController();let count=0;
 const h=setup({getHistoricalFile:async(r,o)=>{count++;assert.deepEqual(r,repo);assert.deepEqual(o,{commit:p.commit,path:p.path,signal:controller.signal});return {entries:[]};}});
 assert.equal((await h.call('vcs/tree-file',p)).error.code,'vcs/rediscover-required');await h.discover();
 for(const extra of [{root:'/evil'},{path:'../secret'},{path:'/secret'},{path:''},{path:null},{path:'a//b'},{path:'a/./b'},{path:'x\0'},{depth:10},{id:'b'.repeat(64)},{commit:'HEAD'},{parentIndex:0}])assert.equal((await h.call('vcs/tree-file',{...p,...extra})).error.code,'vcs/invalid-request');
 assert.equal(count,0);assert.equal((await h.call('vcs/tree-file',p,controller.signal)).ok,true);assert.equal(count,1);
 h.expire();assert.equal((await h.call('vcs/tree-file',p)).error.code,'vcs/rediscover-required');
 const moved=setup({getHistoricalFile:async()=>{moved.move();return {};}});await moved.discover();assert.equal((await moved.call('vcs/tree-file',p)).error.code,'vcs/rediscover-required');
 const cancel=setup({getHistoricalFile:async()=>{controller.abort();return {};}});await cancel.discover();assert.equal((await cancel.call('vcs/tree-file',p,controller.signal)).error.code,'vcs/cancelled');
});
test('historical tree enforces commit-only grants and rejects stale results',async()=>{
 const p={...payload,commit:'a'.repeat(40)},controller=new AbortController();let count=0;
 const h=setup({getHistoricalTree:async(r,o)=>{count++;assert.deepEqual(r,repo);assert.deepEqual(o,{commit:p.commit,signal:controller.signal});return {entries:[]};}});
 assert.equal((await h.call('vcs/tree',p)).error.code,'vcs/rediscover-required');await h.discover();
 for(const extra of [{root:'/evil'},{path:'secret'},{depth:10},{id:'b'.repeat(64)},{commit:'HEAD'},{parentIndex:0}])assert.equal((await h.call('vcs/tree',{...p,...extra})).error.code,'vcs/invalid-request');
 assert.equal(count,0);assert.equal((await h.call('vcs/tree',p,controller.signal)).ok,true);assert.equal(count,1);
 h.expire();assert.equal((await h.call('vcs/tree',p)).error.code,'vcs/rediscover-required');
 const moved=setup({getHistoricalTree:async()=>{moved.move();return {};}});await moved.discover();assert.equal((await moved.call('vcs/tree',p)).error.code,'vcs/rediscover-required');
 const cancel=setup({getHistoricalTree:async()=>{controller.abort();return {};}});await cancel.discover();assert.equal((await cancel.call('vcs/tree',p,controller.signal)).error.code,'vcs/cancelled');
});
test('image RPC budget leaves room for history and recovers after errors and cancellation',async()=>{
 const p={...payload,commit:'a'.repeat(40),id:'b'.repeat(64)};let started=0,ready;const both=new Promise(resolve=>ready=resolve),finish=[];
 const h=setup({getCommitImage:async()=>{started++;if(started===2)ready();return new Promise((resolve,reject)=>finish.push({resolve,reject}));}});await h.discover();
 const controller=new AbortController(),one=h.call('vcs/commit-image',p),two=h.call('vcs/commit-image',p,controller.signal);await both;
 assert.equal((await h.call('vcs/commit-image',p)).error.code,'vcs/busy');assert.equal(started,2);
 assert.equal((await h.call('vcs/history',payload)).ok,true);
 finish[0].reject(Error('image failed'));controller.abort();finish[1].resolve({});
 assert.equal((await one).error.code,'vcs/operation-failed');assert.equal((await two).error.code,'vcs/cancelled');
 const three=h.call('vcs/commit-image',p);while(started<3)await new Promise(resolve=>setImmediate(resolve));finish[2].resolve({});assert.equal((await three).ok,true);
});
test('image RPC enforces grants strict fields side defaults and cancellation',async()=>{
 const p={...payload,commit:'a'.repeat(40),id:'b'.repeat(64)},controller=new AbortController();const seen=[];
 const h=setup({getCommitImage:async(r,o)=>{assert.deepEqual(r,repo);assert.equal(o.signal,controller.signal);seen.push(o);return {mime:'image/png'};}});
 assert.equal((await h.call('vcs/commit-image',p)).error.code,'vcs/rediscover-required');await h.discover();
 for(const extra of [{path:'secret'},{url:'https://example.com'},{width:1},{side:null},{side:'both'},{commit:'HEAD'},{id:'bad'},{parentIndex:-1}])assert.equal((await h.call('vcs/commit-image',{...p,...extra})).error.code,'vcs/invalid-request');
 assert.equal(seen.length,0);assert.equal((await h.call('vcs/commit-image',{...p,sessionId:'foreign'})).error.code,'vcs/rediscover-required');
 assert.equal((await h.call('vcs/commit-image',p,controller.signal)).ok,true);assert.equal(seen[0].side,'right');assert.equal(seen[0].parentIndex,0);assert.equal(seen[0].id,p.id);assert.equal(seen[0].commit,p.commit);
 assert.equal((await h.call('vcs/commit-image',{...p,side:'left',parentIndex:1},controller.signal)).ok,true);assert.equal(seen[1].side,'left');assert.equal(seen[1].parentIndex,1);
 h.expire();assert.equal((await h.call('vcs/commit-image',p)).error.code,'vcs/rediscover-required');
 const moved=setup({getCommitImage:async()=>{moved.move();return {};}});await moved.discover();assert.equal((await moved.call('vcs/commit-image',p)).error.code,'vcs/rediscover-required');
 const cancel=setup({getCommitImage:async()=>{controller.abort();return {};}});await cancel.discover();assert.equal((await cancel.call('vcs/commit-image',p,controller.signal)).error.code,'vcs/cancelled');
});
test('blame enforces grants opaque selection fixed limits and stale cancellation',async()=>{
 const p={...payload,commit:'a'.repeat(40),id:'b'.repeat(64)},controller=new AbortController();let calls=0;
 const h=setup({getFileBlame:async(r,o)=>{calls++;assert.deepEqual(r,repo);assert.deepEqual(o,{commit:p.commit,parentIndex:0,id:p.id,signal:controller.signal});return {lines:[]};}});
 assert.equal((await h.call('vcs/blame',p)).error.code,'vcs/rediscover-required');await h.discover();
 for(const extra of [{path:'secret'},{root:'/evil'},{limit:9999},{offset:1},{commit:'HEAD'},{id:'bad'},{parentIndex:-1}])assert.equal((await h.call('vcs/blame',{...p,...extra})).error.code,'vcs/invalid-request');
 assert.equal(calls,0);assert.equal((await h.call('vcs/blame',p,controller.signal)).ok,true);assert.equal(calls,1);
 h.expire();assert.equal((await h.call('vcs/blame',p)).error.code,'vcs/rediscover-required');
 const moved=setup({getFileBlame:async()=>{moved.move();return {};}});await moved.discover();assert.equal((await moved.call('vcs/blame',p)).error.code,'vcs/rediscover-required');
 const cancelled=setup({getFileBlame:async()=>{controller.abort();return {};}});await cancelled.discover();assert.equal((await cancelled.call('vcs/blame',p,controller.signal)).error.code,'vcs/cancelled');
});
test('file history validates opaque selection pagination and session grants',async()=>{
 const p={...payload,commit:'a'.repeat(40),id:'b'.repeat(64)};const controller=new AbortController();let calls=0;
 const h=setup({listFileHistory:async(r,o)=>{calls++;assert.deepEqual(r,repo);assert.deepEqual(o,{commit:p.commit,id:p.id,parentIndex:0,offset:0,limit:50,signal:controller.signal});return {commits:[]};}});
 assert.equal((await h.call('vcs/file-history',p)).error.code,'vcs/rediscover-required');await h.discover();
 for(const extra of [{path:'secret'},{root:'/evil'},{snapshot:p.commit},{commit:'HEAD'},{id:'bad'},{parentIndex:null},{offset:null},{offset:10001},{limit:101}])assert.equal((await h.call('vcs/file-history',{...p,...extra})).error.code,'vcs/invalid-request');
 assert.equal(calls,0);assert.equal((await h.call('vcs/file-history',p,controller.signal)).ok,true);assert.equal(calls,1);
 h.expire();assert.equal((await h.call('vcs/file-history',p)).error.code,'vcs/rediscover-required');
 const cancel=setup({listFileHistory:async()=>{controller.abort();return {};}});await cancel.discover();assert.equal((await cancel.call('vcs/file-history',p,controller.signal)).error.code,'vcs/cancelled');
});
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
