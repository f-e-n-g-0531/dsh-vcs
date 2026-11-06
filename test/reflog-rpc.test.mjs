import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../index.mjs';

function fixture({type='git',read,timeout=15000}={}) {
 const root='/rpc-reflog-'+Math.random();let cwd=root,calls=0;
 const value={entries:[{id:'a'.repeat(40),selector:'HEAD@{2024-01-01T00:00:00+00:00}',message:'commit: 初次',date:'2024-01-01T00:00:00+00:00'}],truncated:false};
 const api={discoverRepositories:async()=>({repositories:[{id:'r',type,root}],warnings:[]}),listReflog:async(repo,options)=>{calls++;assert.equal(repo.root,root);assert.deepEqual(Object.keys(options),['signal']);return read?read(options):value;}};
 const handle=createHandler({sessions:{get:()=>({header:{cwd}})}},api,4,{operationTimeoutMs:timeout});
 return {handle,address:{sessionId:'s',repositoryId:'r'},setCwd:v=>cwd=v,calls:()=>calls,value};
}
const discover=f=>f.handle('vcs/repositories',{sessionId:'s'});

test('reflog RPC requires discovered Git grant, accepts only sessionId/repositoryId and returns adapter shape',async()=>{
 const f=fixture();
 try {
  assert.equal((await f.handle('vcs/reflog',f.address)).error.code,'vcs/rediscover-required');
  assert.equal(f.calls(),0);await discover(f);
  for(const extra of [{offset:0},{limit:200},{cursor:'x'},{ref:'HEAD'},{selector:'HEAD@{0}'},{root:'/bad'},{snapshot:'a'.repeat(40)},{mode:'all'}])assert.equal((await f.handle('vcs/reflog',{...f.address,...extra})).error.code,'vcs/invalid-request');
  for(const address of [{sessionId:'s'},{...f.address,repositoryId:23},{...f.address,sessionId:'../s'},{...f.address,repositoryId:'unknown'}])assert.equal((await f.handle('vcs/reflog',address)).ok,false);
  assert.equal(f.calls(),0);
  assert.deepEqual(await f.handle('vcs/reflog',f.address),{ok:true,value:f.value});assert.equal(f.calls(),1);
  f.setCwd('/other');assert.equal((await f.handle('vcs/reflog',f.address)).error.code,'vcs/rediscover-required');assert.equal(f.calls(),1);
 } finally {f.handle.dispose();}
 const svn=fixture({type:'svn'});
 try {await discover(svn);assert.equal((await svn.handle('vcs/reflog',svn.address)).error.code,'vcs/invalid-request');assert.equal(svn.calls(),0);}finally{svn.handle.dispose();}
});

test('post-read authorization rejects changed cwd and replaced discovery grants',async()=>{
 let f;f=fixture({read:async()=>{f.setCwd('/changed-during-read');return f.value;}});
 try {await discover(f);assert.equal((await f.handle('vcs/reflog',f.address)).error.code,'vcs/rediscover-required');}finally{f.handle.dispose();}
 let g;g=fixture({read:async()=>{await discover(g);return g.value;}});
 try {await discover(g);assert.equal((await g.handle('vcs/reflog',g.address)).error.code,'vcs/rediscover-required');}finally{g.handle.dispose();}
});

test('cancellation and adapter errors do not become empty success; capacity is released',async()=>{
 const controller=new AbortController();let f;f=fixture({read:async({signal})=>{assert.equal(signal,controller.signal);controller.abort();signal.throwIfAborted();}});
 try {await discover(f);assert.equal((await f.handle('vcs/reflog',f.address,controller.signal)).error.code,'vcs/cancelled');
 const early=new AbortController();early.abort();const before=f.calls();assert.equal((await f.handle('vcs/reflog',f.address,early.signal)).error.code,'vcs/cancelled');assert.equal(f.calls(),before);
 }finally{f.handle.dispose();}
 const g=fixture({read:async()=>{throw new Error('corrupt reflog');}});
 try {await discover(g);for(let i=0;i<5;i++)assert.equal((await g.handle('vcs/reflog',g.address)).error.code,'vcs/operation-failed');}finally{g.handle.dispose();}
});
