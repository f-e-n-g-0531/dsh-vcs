import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../index.mjs';
const id='a'.repeat(64),oid='b'.repeat(40);
function fixture({type='git',root='/rpc-index-'+Math.random(),apply,prepare,timeout=15000,clock=Date.now,ttlMs}={}){
 let cwd=root,writes=0,prepares=0,clears=0;
 const api={discoverRepositories:async()=>({repositories:[{id:'r',type,root}],warnings:[]}),
 prepareSelectedIndexStage:async(repo,request)=>{prepares++;assert.deepEqual(Object.keys(request).sort(),['id','signal']);assert.equal(request.id,id);return prepare?prepare(request):{path:'selected.txt',head:oid,index:{oid},target:{oid},fingerprint:'private'};},
 applyIndexStage:async(repo,r)=>{writes++;return apply?apply(r):(r.onStart(),{path:r.snapshot.path});},
 prepareSelectedIndexUnstage:async()=>({path:'staged.txt',head:oid,index:{oid},target:{oid}}),applyIndexUnstage:async(repo,r)=>(r.onStart(),{}),
 listChanges:async()=>{throw Error('ordinary status must not resolve index selectors');},listLocalBranches:async()=>({branches:[]}),
 prepareLocalBranchSwitch:async()=>({current:{},target:{}}),switchLocalBranch:async(repo,r)=>(r.onStart(),{}),clearHistoricalCache:()=>clears++};
 const handle=createHandler({sessions:{get:()=>({header:{cwd}})}},api,4,{operationTimeoutMs:timeout,now:clock,...(ttlMs?{ttlMs}:{})});
 return {handle,address:{sessionId:'s',repositoryId:'r'},setCwd:v=>cwd=v,writes:()=>writes,prepares:()=>prepares,clears:()=>clears};
}
const discover=f=>f.handle('vcs/repositories',{sessionId:'s'});
const prepare=f=>f.handle('vcs/index-stage-prepare',{...f.address,id});
const confirm=(f,token,signal)=>f.handle('vcs/index-stage-confirm',{...f.address,token},signal);
test('strict authenticated Git two-phase ID selection never accepts browser paths or snapshots',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());assert.equal((await prepare(f)).error.code,'vcs/rediscover-required');await discover(f);
 for(const extra of [{path:'selected.txt'},{root:'/bad'},{snapshot:{}},{token:'c'.repeat(64)},{mode:'unstaged'},{action:'stage'},{id:'selected.txt'},{id:null}])assert.equal((await f.handle('vcs/index-stage-prepare',{...f.address,id,...extra})).error.code,'vcs/invalid-request');
 assert.equal(f.prepares(),0);const p=await prepare(f);assert.equal(p.ok,true);assert.equal(p.value.path,'selected.txt');assert.equal(p.value.fingerprint,undefined);assert.equal(p.value.action,'stage');assert.deepEqual(Object.keys(p.value).sort(),['action','expiresAt','head','index','path','target','token']);assert.match(p.value.token,/^[a-f0-9]{64}$/);
 for(const extra of [{path:'selected.txt'},{id},{snapshot:{}},{mode:'unstaged'},{action:'stage'},{token:'bad'},{token:'A'.repeat(64)}])assert.equal((await f.handle('vcs/index-stage-confirm',{...f.address,token:p.value.token,...extra})).error.code,'vcs/invalid-request');
 assert.equal(f.writes(),0);const clears=f.clears();assert.equal((await confirm(f,p.value.token)).ok,true);assert.ok(f.clears()>clears);assert.equal(f.writes(),1);assert.equal((await confirm(f,p.value.token)).error.code,'vcs/index-confirmation-invalid');assert.ok(f.clears()>0);
});
test('SVN, mismatched Session, stale cwd, rediscovery, expiry and disposal cannot mutate',async t=>{
 const svn=fixture({type:'svn'});t.after(()=>svn.handle.dispose());await discover(svn);assert.equal((await prepare(svn)).error.code,'vcs/invalid-request');assert.equal((await confirm(svn,'c'.repeat(64))).error.code,'vcs/invalid-request');assert.equal(svn.prepares(),0);
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);let p=await prepare(f);assert.equal((await f.handle('vcs/index-stage-confirm',{...f.address,sessionId:'other',token:p.value.token})).error.code,'vcs/rediscover-required');f.setCwd('/changed');assert.equal((await confirm(f,p.value.token)).error.code,'vcs/rediscover-required');
 await discover(f);p=await prepare(f);await discover(f);assert.equal((await confirm(f,p.value.token)).error.code,'vcs/index-confirmation-invalid');p=await prepare(f);f.handle.dispose();assert.equal((await confirm(f,p.value.token)).error.code,'vcs/rediscover-required');assert.equal(f.writes(),0);
 let now=1000;const g=fixture({clock:()=>now});t.after(()=>g.handle.dispose());await discover(g);p=await prepare(g);now+=60001;assert.equal((await confirm(g,p.value.token)).error.code,'vcs/index-confirmation-invalid');assert.equal(g.writes(),0);
});
test('stale adapter rejection is preserved and the token is consumed',async t=>{
 const f=fixture({apply:async()=>{throw Object.assign(Error('changed'),{code:'vcs/index-stale'});}});t.after(()=>f.handle.dispose());await discover(f);const p=await prepare(f);assert.equal((await confirm(f,p.value.token)).error.code,'vcs/index-stale');assert.equal((await confirm(f,p.value.token)).error.code,'vcs/index-confirmation-invalid');
});
test('pre-aborted outer lifetime is conservative; adapter pre-start cancellation is safe and post-start unknown',async t=>{
 const c=new AbortController(),f=fixture();t.after(()=>f.handle.dispose());await discover(f);const p=await prepare(f);c.abort();assert.equal((await confirm(f,p.value.token,c.signal)).error.code,'vcs/index-outcome-unknown');assert.equal(f.writes(),0);
 const d=new AbortController(),g=fixture({apply:async r=>{r.onStart();d.abort();r.signal.throwIfAborted();}});t.after(()=>g.handle.dispose());await discover(g);const q=await prepare(g);const unknown=await confirm(g,q.value.token,d.signal);assert.equal(unknown.error.code,'vcs/index-outcome-unknown');assert.match(unknown.error.message,/Append-only object writes/);
 const h=fixture({apply:async()=>{throw Object.assign(Error('cancelled'),{name:'AbortError'});}});t.after(()=>h.handle.dispose());await discover(h);const z=await prepare(h);assert.equal((await confirm(h,z.value.token)).error.code,'vcs/cancelled');
});
test('outer post-work deadline cannot turn completed index mutation into safe timeout',async t=>{
 const f=fixture({timeout:15,apply:async r=>{r.onStart();await new Promise(resolve=>setTimeout(resolve,35));return {path:'selected.txt'};}});t.after(()=>f.handle.dispose());await discover(f);const p=await prepare(f);const result=await confirm(f,p.value.token);assert.equal(result.error.code,'vcs/index-outcome-unknown');assert.match(result.error.message,/Append-only object writes/);assert.equal(f.writes(),1);
});
test('adapter unknown wins over aborted signal in both catches',async t=>{
 const c=new AbortController(),f=fixture({apply:async()=>{c.abort();throw Object.assign(Error('uncertain'),{code:'vcs/index-outcome-unknown'});}});t.after(()=>f.handle.dispose());await discover(f);const p=await prepare(f);assert.equal((await confirm(f,p.value.token,c.signal)).error.code,'vcs/index-outcome-unknown');
});
test('index confirmations share process mutex with readers and branch writes across handlers',async t=>{
 let finish,start;const gate=new Promise(r=>finish=r),started=new Promise(r=>start=r),root='/rpc-index-shared-'+Math.random();
 const f=fixture({root,apply:async r=>{r.onStart();start();await gate;return {};}}),g=fixture({root});t.after(()=>{finish();f.handle.dispose();g.handle.dispose();});await discover(f);await discover(g);
 const up=await g.handle('vcs/index-unstage-prepare',{...g.address,id});
 const bp=await g.handle('vcs/branch-switch-prepare',{...g.address,branch:'next'}),p=await prepare(f),pending=confirm(f,p.value.token);await started;
 assert.equal((await g.handle('vcs/index-unstage-confirm',{...g.address,token:up.value.token})).error.code,'vcs/busy');assert.equal((await prepare(g)).error.code,'vcs/busy');assert.equal((await g.handle('vcs/branches',g.address)).error.code,'vcs/busy');assert.equal((await g.handle('vcs/branch-switch-confirm',{...g.address,token:bp.value.token})).error.code,'vcs/busy');finish();assert.equal((await pending).ok,true);assert.equal((await prepare(g)).ok,true);
});
test('stage and unstage tokens never cross operation namespaces and both invalidate on rediscovery',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);
 const stage=await prepare(f),unstage=await f.handle('vcs/index-unstage-prepare',{...f.address,id});
 assert.equal((await f.handle('vcs/index-unstage-confirm',{...f.address,token:stage.value.token})).error.code,'vcs/index-confirmation-invalid');
 assert.equal((await confirm(f,unstage.value.token)).error.code,'vcs/index-confirmation-invalid');assert.equal(f.writes(),0);
 assert.equal((await confirm(f,stage.value.token)).ok,true);assert.equal((await f.handle('vcs/index-unstage-confirm',{...f.address,token:unstage.value.token})).ok,true);
 const s=await prepare(f),u=await f.handle('vcs/index-unstage-prepare',{...f.address,id});await discover(f);
 assert.equal((await confirm(f,s.value.token)).error.code,'vcs/index-confirmation-invalid');assert.equal((await f.handle('vcs/index-unstage-confirm',{...f.address,token:u.value.token})).error.code,'vcs/index-confirmation-invalid');
});

test('repository mismatch and expired grants reject without mutation',async t=>{
 let now=1000;const f=fixture({clock:()=>now,ttlMs:10});t.after(()=>f.handle.dispose());await discover(f);const p=await prepare(f);
 assert.equal((await f.handle('vcs/index-stage-confirm',{...f.address,repositoryId:'other',token:p.value.token})).error.code,'vcs/rediscover-required');
 now+=11;assert.equal((await confirm(f,p.value.token)).error.code,'vcs/rediscover-required');assert.equal(f.writes(),0);
});
test('grant revocation during preparation cannot issue a usable token; after start it is unknown',async t=>{
 let f;f=fixture({prepare:async()=>{f.setCwd('/changed-during-prepare');return {path:'selected.txt'};}});t.after(()=>f.handle.dispose());await discover(f);
 assert.equal((await prepare(f)).error.code,'vcs/rediscover-required');assert.equal(f.writes(),0);
 let g;g=fixture({apply:async r=>{r.onStart();g.setCwd('/changed-during-apply');return {};}});t.after(()=>g.handle.dispose());await discover(g);const p=await prepare(g),result=await confirm(g,p.value.token);
 assert.equal(result.error.code,'vcs/index-outcome-unknown');assert.match(result.error.message,/Append-only object writes/);
});
