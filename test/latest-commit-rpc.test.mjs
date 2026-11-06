import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../index.mjs';
import {acquireRepositoryAccess} from '../confirmed-operation.mjs';
import {currentOperationBudget} from '../src/operation-budget.mjs';
import {readLatestCommit} from '../latest-commit.mjs';
import * as apiExports from '../vcs.mjs';
const endpoint='vcs/latest-commit',oid='a'.repeat(40);
const metadata=()=>({head:oid,ref:'refs/heads/main',objectFormat:'sha1',tree:oid,parents:[oid],author:{name:'A',email:'a@example.test',timestamp:1,timezone:'+0800'},committer:{name:'C',email:'c@example.test',timestamp:2,timezone:'-0000'},message:'Subject\n\nBody\ttext\n\n',messageBytes:Buffer.byteLength('Subject\n\nBody\ttext\n\n')});
function fixture({type='git',read,timeout=15000,clock=Date.now,ttlMs=300000,maxActive=4}={}){
 const root='/latest-rpc-'+Math.random();let cwd=root,lookups=0,reads=0,onLookup;
 const api={discoverRepositories:async()=>({repositories:[{id:'r',type,root,branch:'discovery-only',relativePath:'.',extra:'must not reach adapter'}],warnings:[]}),readLatestCommit:async(repo,options)=>{reads++;assert.deepEqual(repo,{type,root});assert.deepEqual(Reflect.ownKeys(options),['signal']);return read?read(repo,options):metadata();}};
 const handle=createHandler({sessions:{get:()=>{lookups++;onLookup?.();return {header:{cwd}};}}},api,maxActive,{operationTimeoutMs:timeout,now:clock,ttlMs});
 return {root,handle,address:{sessionId:'s',repositoryId:'r'},setCwd:value=>cwd=value,onLookup:fn=>onLookup=fn,lookups:()=>lookups,reads:()=>reads};
}
const discover=(f,sessionId='s')=>f.handle('vcs/repositories',{sessionId});
const latest=(f,signal)=>f.handle(endpoint,f.address,signal);
const code=async promise=>(await promise).error?.code;
test('reexports the exact readLatestCommit adapter',()=>assert.equal(apiExports.readLatestCommit,readLatestCommit));
test('exact own descriptor address is validated before any lookup, getter or dispatch',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());let getters=0;
 const cases=[null,[],42,Object.create(f.address),Object.assign(Object.create({extra:1}),f.address),{...f.address,root:'/evil'},{...f.address,path:'x'},{...f.address,commit:oid},{...f.address,[Symbol()]:1}];
 const hidden={...f.address};Object.defineProperty(hidden,'extra',{value:1});cases.push(hidden);
 for(const key of ['sessionId','repositoryId']){const missing={...f.address};delete missing[key];cases.push(missing);const accessor={...f.address};Object.defineProperty(accessor,key,{get(){getters++;return 's';}});cases.push(accessor);for(const value of [undefined,null,1,''])cases.push({...f.address,[key]:value});}
 for(const sessionId of ['a/b','a\\b','a\0b','s'.repeat(257)])cases.push({...f.address,sessionId});cases.push({...f.address,repositoryId:'r'.repeat(1025)});
 for(const payload of cases)assert.equal(await code(f.handle(endpoint,payload)),'vcs/invalid-request');
 assert.equal(getters,0);assert.equal(f.lookups(),0);assert.equal(f.reads(),0);
});
test('snapshot precedes lookup; adapter gets strict repository and metadata/message unchanged',async t=>{
 const value=metadata(),f=fixture({read:()=>value});t.after(()=>f.handle.dispose());await discover(f);const payload={...f.address};f.onLookup(()=>{payload.sessionId='other';payload.repositoryId='missing';});
 const result=await f.handle(endpoint,payload);assert.equal(result.ok,true);assert.equal(result.value,value);assert.equal(result.value.message,'Subject\n\nBody\ttext\n\n');assert.deepEqual(result.value,metadata());assert.equal(f.reads(),1);
 f.onLookup(undefined);const plain=Object.assign(Object.create(null),f.address);assert.equal((await f.handle(endpoint,plain)).ok,true);
});
test('Session cwd and discovery grants authorize Git only',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());assert.equal(await code(latest(f)),'vcs/rediscover-required');await discover(f);
 assert.equal(await code(f.handle(endpoint,{...f.address,sessionId:'other'})),'vcs/rediscover-required');assert.equal(await code(f.handle(endpoint,{...f.address,repositoryId:'other'})),'vcs/rediscover-required');assert.equal(f.reads(),0);
 f.setCwd('/changed');assert.equal(await code(latest(f)),'vcs/rediscover-required');assert.equal(f.reads(),0);
 const s=fixture({type:'svn'});t.after(()=>s.handle.dispose());await discover(s);assert.equal(await code(latest(s)),'vcs/invalid-request');assert.equal(s.reads(),0);
});
test('authoritative persisted Session lookup supplies cwd, never browser fields',async t=>{
 let stats=0;const handle=createHandler({sessions:{get:()=>undefined},sessionPersistence:{stat:async(id,{signal})=>{assert.equal(id,'saved');signal?.throwIfAborted();stats++;return {header:{cwd:'/authoritative'}};}}},{discoverRepositories:async cwd=>{assert.equal(cwd,'/authoritative');return {repositories:[{id:'r',type:'git',root:'/authoritative/repo'}],warnings:[]};},readLatestCommit:async repo=>{assert.deepEqual(repo,{type:'git',root:'/authoritative/repo'});return metadata();}});t.after(()=>handle.dispose());
 assert.equal((await handle('vcs/repositories',{sessionId:'saved'})).ok,true);assert.equal((await handle(endpoint,{sessionId:'saved',repositoryId:'r'})).ok,true);assert.equal(stats,4);
});
test('post-read reauthorization rejects cwd, replacement, expiry and disposal',async t=>{
 for(const kind of ['cwd','replace','expiry','dispose']){let now=1000,f;f=fixture({clock:()=>now,read:async()=>{if(kind==='cwd')f.setCwd('/changed');if(kind==='replace')await discover(f);if(kind==='expiry')now+=300001;if(kind==='dispose')f.handle.dispose();return metadata();}});t.after(()=>f.handle.dispose());await discover(f);assert.equal(await code(latest(f)),'vcs/rediscover-required',kind);}
});
test('read shares process reader lock, excludes writers and releases on failure',async t=>{
 let finish,start;const gate=new Promise(resolve=>finish=resolve),started=new Promise(resolve=>start=resolve);const f=fixture({read:async()=>{start();await gate;return metadata();}});t.after(()=>{finish();f.handle.dispose();});await discover(f);
 const releaseWriter=acquireRepositoryAccess(f.root,true);assert.equal(await code(latest(f)),'vcs/busy');assert.equal(f.reads(),0);releaseWriter();
 const pending=latest(f);await started;assert.throws(()=>acquireRepositoryAccess(f.root,true),{code:'vcs/busy'});const releaseReader=acquireRepositoryAccess(f.root);releaseReader();finish();assert.equal((await pending).ok,true);acquireRepositoryAccess(f.root,true)();
 const g=fixture({read:()=>{throw Object.assign(Error('stale metadata'),{code:'vcs/latest-commit'});}});t.after(()=>g.handle.dispose());await discover(g);assert.equal(await code(latest(g)),'vcs/latest-commit');acquireRepositoryAccess(g.root,true)();
});
test('cancellation, inherited budget and stale errors keep read-only outcome semantics',async t=>{
 const abort=new AbortController(),f=fixture({read:async(repo,{signal})=>{assert.equal(signal,abort.signal);abort.abort();signal.throwIfAborted();}});t.after(()=>f.handle.dispose());await discover(f);assert.equal(await code(latest(f,abort.signal)),'vcs/cancelled');acquireRepositoryAccess(f.root,true)();
 const pre=new AbortController();pre.abort();const g=fixture();t.after(()=>g.handle.dispose());assert.equal(await code(latest(g,pre.signal)),'vcs/cancelled');assert.equal(g.lookups(),0);
 const h=fixture({timeout:20,read:async()=>{assert.ok(currentOperationBudget());await new Promise(resolve=>setTimeout(resolve,50));return metadata();}});t.after(()=>h.handle.dispose());await discover(h);assert.equal(await code(latest(h)),'vcs/timeout');acquireRepositoryAccess(h.root,true)();
 for(const [error,expected] of [[Object.assign(Error('stale'),{code:'vcs/latest-commit'}),'vcs/latest-commit'],[Object.assign(Error('stale'),{code:'vcs/commit-stale'}),'vcs/commit-stale'],[Object.assign(Error('timeout'),{code:'TIMEOUT'}),'vcs/timeout'],[Error('plain'),'vcs/operation-failed']]){const k=fixture({read:()=>{throw error;}});t.after(()=>k.handle.dispose());await discover(k);const result=await latest(k);assert.equal(result.error.code,expected);assert.equal(result.error.message,error.message);assert.doesNotMatch(result.error.code,/outcome-unknown/);}
});
