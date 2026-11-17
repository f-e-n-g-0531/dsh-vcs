import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../index.mjs';
import {acquireRepositoryAccess} from '../confirmed-operation.mjs';

function fixture({type='git',root='/rpc-switch-'+Math.random()}={}){
 let cwd=root,lookups=0;const calls=[];
 const removed=name=>async()=>{calls.push(name);throw Error('Removed branch API must never run: '+name);};
 const api={discoverRepositories:async()=>({repositories:[{id:'r',type,root}],warnings:[]}),
  listLocalBranches:removed('list'),prepareLocalBranchSwitch:removed('prepare'),switchLocalBranch:removed('switch')};
 const handle=createHandler({sessions:{get:()=>{lookups++;return {header:{cwd}};}}},api);
 return {handle,root,address:{sessionId:'s',repositoryId:'r'},setCwd:v=>cwd=v,calls,lookups:()=>lookups};
}
const discover=f=>f.handle('vcs/repositories',{sessionId:'s'});
const requests=f=>[
 ['vcs/branches',{...f.address}],
 ['vcs/branch-switch-prepare',{...f.address,branch:'next'}],
 ['vcs/branch-switch-confirm',{...f.address,token:'a'.repeat(64)}],
];
async function assertRemoved(f){
 const lookups=f.lookups();
 for(const [endpoint,payload] of requests(f)){
  const result=await f.handle(endpoint,payload);assert.equal(result.ok,false);assert.equal(result.error.code,'vcs/not-found',endpoint);
 }
 assert.equal(f.lookups(),lookups);assert.deepEqual(f.calls,[]);
}
test('removed branch listing and switching are unavailable before and after Git discovery',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await assertRemoved(f);assert.equal((await discover(f)).ok,true);await assertRemoved(f);
});
test('SVN and stale Session grants cannot revive removed branch endpoints',async t=>{
 const svn=fixture({type:'svn'}),f=fixture();t.after(()=>{svn.handle.dispose();f.handle.dispose();});
 assert.equal((await discover(svn)).ok,true);await assertRemoved(svn);
 await discover(f);f.setCwd('/changed');await assertRemoved(f);
});
test('rediscovery disposal and repository writer locks cannot revive removed branch endpoints',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);await discover(f);await assertRemoved(f);
 const release=acquireRepositoryAccess(f.root,true);try{await assertRemoved(f);}finally{release();}
 f.handle.dispose();await assertRemoved(f);
});
test('removed branch requests never validate payloads or dispatch adapters',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);let getters=0;
 const accessor={};Object.defineProperty(accessor,'sessionId',{get(){getters++;throw Error('must not read removed payload');}});
 for(const [endpoint] of requests(f))for(const payload of [null,{},accessor,{...f.address,root:'/bad',snapshot:{},branch:null,token:'fake'}]){
  assert.equal((await f.handle(endpoint,payload)).error.code,'vcs/not-found',endpoint);
 }
 assert.equal(getters,0);assert.deepEqual(f.calls,[]);
});
