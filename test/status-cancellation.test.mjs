import test from 'node:test';import assert from 'node:assert/strict';
import {createHandler} from '../index.mjs';import {listChanges} from '../vcs.mjs';
test('status RPC forwards cancellation and releases admission capacity',async()=>{
 const c=new AbortController(),repo={id:'r',root:'/fixture',type:'git'};let started;
 const began=new Promise(resolve=>started=resolve);
 const api={discoverRepositories:async()=>({repositories:[repo],warnings:[]}),listChanges:async(_repo,mode,{signal})=>{assert.equal(mode,'all');assert.equal(signal,c.signal);started();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}};
 const handler=createHandler({sessions:{get:()=>({header:{cwd:'/fixture'}})}},api,1);
 await handler('vcs/repositories',{sessionId:'s'});const pending=handler('vcs/status',{sessionId:'s',repositoryId:'r'},c.signal);await began;c.abort();assert.equal((await pending).error.code,'vcs/cancelled');assert.equal((await handler('vcs/repositories',{sessionId:'s'})).ok,true);
});
test('Git and SVN status respect preabort before probing',async()=>{for(const type of ['git','svn']){const c=new AbortController();c.abort();await assert.rejects(listChanges({root:'/nonexistent',type},'all',{signal:c.signal}),{name:'AbortError'});}});
