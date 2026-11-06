import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../index.mjs';
import {acquireRepositoryAccess} from '../confirmed-operation.mjs';
import {currentOperationBudget} from '../src/operation-budget.mjs';
import {prepareBranchDelete} from '../branch-delete-preview.mjs';
import * as vcs from '../vcs.mjs';

const endpoint='vcs/branch-delete-preview',oid='a'.repeat(40),planId='b'.repeat(64);
const summary=(name='feature/安全')=>({action:'branch-delete',name,ref:'refs/heads/'+name,objectFormat:'sha1',current:{ref:'refs/heads/main',oid},target:{ref:'refs/heads/'+name,oid},merged:true,proof:[oid],planId});
function fixture({type='git',read,timeout=15000,clock=Date.now,maxSessions=128}={}){
 const root='/branch-delete-preview-rpc-'+Math.random();let cwd=root,lookups=0,reads=0,clears=0,writes=0,onLookup;
 const api={discoverRepositories:async()=>({repositories:[{id:'r',type,root,branch:'discovery-only',extra:'private'}],warnings:[]}),
  prepareBranchDelete:async(repo,options)=>{reads++;assert.deepEqual(repo,{type,root});assert.deepEqual(Reflect.ownKeys(options),['name','signal']);return read?read(repo,options):summary(options.name);},
  applyBranchDelete:async()=>{writes++;throw Error('Deletion must not be called');},clearHistoricalCache:()=>clears++};
 const handle=createHandler({sessions:{get:()=>{lookups++;onLookup?.();return {header:{cwd}};}}},api,4,{operationTimeoutMs:timeout,now:clock,maxSessions});
 return {root,handle,address:{sessionId:'s',repositoryId:'r'},setCwd:v=>cwd=v,onLookup:fn=>onLookup=fn,lookups:()=>lookups,reads:()=>reads,clears:()=>clears,writes:()=>writes};
}
const discover=(f,sessionId='s')=>f.handle('vcs/repositories',{sessionId});
const payload=f=>({...f.address,name:'feature/安全'});
const preview=(f,signal)=>f.handle(endpoint,payload(f),signal);
const code=async promise=>(await promise).error?.code;
test('adapter exports prepare only, never apply deletion',()=>{assert.equal(vcs.prepareBranchDelete,prepareBranchDelete);assert.equal(Object.hasOwn(vcs,'applyBranchDelete'),false);});
test('strict exact own-data schema rejects before lookup and before cancellation budget',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());let getters=0;const p=payload(f),aborted=new AbortController();aborted.abort();
 const cases=[null,[],42,Object.create(p),Object.assign(Object.create({x:1}),p),{...p,root:'/evil'},{...p,token:planId},{...p,snapshot:{}},{...p,force:true},{...p,[Symbol()]:1}];
 const hidden={...p};Object.defineProperty(hidden,'extra',{value:1});cases.push(hidden);
 for(const key of ['sessionId','repositoryId','name']){const missing={...p};delete missing[key];cases.push(missing);const getter={...p};Object.defineProperty(getter,key,{get(){getters++;return p[key];}});cases.push(getter);for(const value of [undefined,null,1,''])cases.push({...p,[key]:value});}
 for(const sessionId of ['a/b','a\\b','a\0b','s'.repeat(257)])cases.push({...p,sessionId});cases.push({...p,repositoryId:'r'.repeat(1025)});
 for(const value of cases){assert.equal(await code(f.handle(endpoint,value)),'vcs/invalid-request');assert.equal(await code(f.handle(endpoint,value,aborted.signal)),'vcs/invalid-request');}
 assert.equal(getters,0);assert.equal(f.lookups(),0);assert.equal(f.reads(),0);
});
test('portable branch name grammar and UTF8 bounds match branch creation',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());
 const invalidNames=['@','HEAD','head','HeAd','-branch','refs/heads/x','a b','a\t','a\n','a\r','a\0','a\u007f','a\u0085','a\u200b','a~b','a^b','a:b','a?b','a*b','a[b','a\\b','a<b','a>b','a"b','a|b','a..b','a@{b','/a','a/','a//b','.a','a/.b','a.','a.lock','a.LoCk','con','a/COM1.txt','nul','LPT9','\ud800','é'.repeat(128),'x'.repeat(256),['x'.repeat(250),'x'.repeat(250),'x'.repeat(250),'x'.repeat(248)].join('/')];
 for(const name of invalidNames)assert.equal(await code(f.handle(endpoint,{...f.address,name})),'vcs/invalid-request',String(name));
 assert.equal(f.lookups(),0);await discover(f);
 for(const name of ['feature/安全','a'.repeat(255),'é'.repeat(127)+'a',['x'.repeat(250),'x'.repeat(250),'x'.repeat(250),'x'.repeat(247)].join('/'),'constructor','HEAD-topic'])assert.equal((await f.handle(endpoint,{...f.address,name})).ok,true,name);
});
test('snapshot precedes lookup and public projection copies exact facts without raw identity or extras',async t=>{
 const raw=summary();raw.token='secret';raw.snapshot={body:Buffer.from('private')};raw.objects=[Buffer.from('bytes')];raw.current.private=Buffer.from('private');raw.target.private='private';raw.proof.private=Buffer.from('private');raw[Symbol()]=Buffer.from('private');
 const f=fixture({read:()=>raw});t.after(()=>f.handle.dispose());await discover(f);const p=payload(f),clears=f.clears();f.onLookup(()=>{p.name='changed';p.sessionId='other';p.repositoryId='missing';});
 const result=await f.handle(endpoint,p);assert.equal(result.ok,true);const value=result.value;assert.deepEqual(value,summary());assert.notEqual(value,raw);assert.notEqual(value.current,raw.current);assert.notEqual(value.target,raw.target);assert.notEqual(value.proof,raw.proof);
 assert.deepEqual(Reflect.ownKeys(value),['action','name','ref','objectFormat','current','target','merged','proof','planId']);assert.ok(Object.isFrozen(value));assert.ok(Object.isFrozen(value.current));assert.ok(Object.isFrozen(value.target));assert.ok(Object.isFrozen(value.proof));
 raw.current.oid='changed';raw.target.oid='changed';raw.proof[0]='changed';assert.equal(value.current.oid,oid);assert.equal(value.target.oid,oid);assert.deepEqual(value.proof,[oid]);assert.equal(f.clears(),clears);assert.equal(f.writes(),0);
 f.onLookup(undefined);assert.equal((await f.handle(endpoint,Object.assign(Object.create(null),payload(f)))).ok,true);
});
test('Git-only discovery authorization rejects missing grants, stale cwd and SVN',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());assert.equal(await code(preview(f)),'vcs/rediscover-required');await discover(f);
 assert.equal(await code(f.handle(endpoint,{...payload(f),sessionId:'other'})),'vcs/rediscover-required');assert.equal(await code(f.handle(endpoint,{...payload(f),repositoryId:'other'})),'vcs/rediscover-required');f.setCwd('/changed');assert.equal(await code(preview(f)),'vcs/rediscover-required');assert.equal(f.reads(),0);
 const s=fixture({type:'svn'});t.after(()=>s.handle.dispose());await discover(s);assert.equal(await code(preview(s)),'vcs/invalid-request');assert.equal(s.reads(),0);
});
test('read completion reauthorizes cwd, replacement, expiry, eviction and disposal',async t=>{
 for(const kind of ['cwd','replace','expiry','evict','dispose']){let now=1000,f;f=fixture({clock:()=>now,maxSessions:1,read:async()=>{if(kind==='cwd')f.setCwd('/changed');if(kind==='replace')await discover(f);if(kind==='expiry')now+=300001;if(kind==='evict')await discover(f,'other');if(kind==='dispose')f.handle.dispose();return summary();}});t.after(()=>f.handle.dispose());await discover(f);assert.equal(await code(preview(f)),'vcs/rediscover-required',kind);assert.equal(f.writes(),0);}
});
test('shared reader excludes process writers, permits readers and releases on failure',async t=>{
 let finish,start;const gate=new Promise(resolve=>finish=resolve),started=new Promise(resolve=>start=resolve);const f=fixture({read:async()=>{start();await gate;return summary();}});t.after(()=>{finish();f.handle.dispose();});await discover(f);
 const release=acquireRepositoryAccess(f.root,true);assert.equal(await code(preview(f)),'vcs/busy');assert.equal(f.reads(),0);release();
 const pending=preview(f);await started;assert.throws(()=>acquireRepositoryAccess(f.root,true),{code:'vcs/busy'});acquireRepositoryAccess(f.root)();finish();assert.equal((await pending).ok,true);acquireRepositoryAccess(f.root,true)();
 const g=fixture({read:()=>{throw Object.assign(Error('stale'),{code:'vcs/branch-delete-preview'});}});t.after(()=>g.handle.dispose());await discover(g);assert.equal(await code(preview(g)),'vcs/branch-delete-preview');acquireRepositoryAccess(g.root,true)();
});
test('no prepare-token or confirm route, even with a valid preview planId',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);const p=await preview(f);assert.equal(p.ok,true);
 for(const route of ['vcs/branch-delete-confirm','vcs/branch-delete-prepare'])assert.equal(await code(f.handle(route,{...f.address,token:p.value.planId})),'vcs/not-found');assert.equal(f.reads(),1);assert.equal(f.writes(),0);
});
test('cancelled and deadline results remain read-only and release shared reader',async t=>{
 const abort=new AbortController(),f=fixture({read:async(repo,{signal})=>{assert.equal(signal,abort.signal);abort.abort();return summary();}});t.after(()=>f.handle.dispose());await discover(f);assert.equal(await code(preview(f,abort.signal)),'vcs/cancelled');acquireRepositoryAccess(f.root,true)();
 const pre=new AbortController();pre.abort();const g=fixture();t.after(()=>g.handle.dispose());assert.equal(await code(preview(g,pre.signal)),'vcs/cancelled');assert.equal(g.lookups(),0);
 const h=fixture({timeout:20,read:async()=>{assert.ok(currentOperationBudget());await new Promise(resolve=>setTimeout(resolve,50));return summary();}});t.after(()=>h.handle.dispose());await discover(h);assert.equal(await code(preview(h)),'vcs/timeout');acquireRepositoryAccess(h.root,true)();assert.equal(h.writes(),0);
});
test('Buffers in public scalar/proof slots are rejected rather than leaked',async t=>{
 for(const mutate of [raw=>raw.name=Buffer.from('name'),raw=>raw.current.oid=Buffer.from('oid'),raw=>raw.target.ref=Buffer.from('ref'),raw=>raw.proof=[Buffer.from('oid')],raw=>raw.planId=Buffer.from('id')]){const raw=summary();mutate(raw);const f=fixture({read:()=>raw});t.after(()=>f.handle.dispose());await discover(f);assert.equal(await code(preview(f)),'vcs/operation-failed');acquireRepositoryAccess(f.root,true)();}
});
