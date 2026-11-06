import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../index.mjs';
import {acquireRepositoryAccess} from '../confirmed-operation.mjs';
const oid='b'.repeat(40), token='c'.repeat(64);
const identity=()=>({name:'Explicit Browser',email:'browser@example.test',timestamp:1730000000,timezone:'+0800'});
function fixture({type='git',root='/rpc-commit-'+Math.random(),apply,prepare,timeout=15000,clock=Date.now,ttlMs}={}){
 let cwd=root,writes=0,prepares=0,clears=0,lookups=0,onLookup;
 const snapshots=[];
 const api={discoverRepositories:async()=>({repositories:[{id:'r',type,root},{id:'r2',type,root:root+'2'}],warnings:[]}),
  prepareCommitPreview:async(repo,r)=>{prepares++;assert.deepEqual(Object.keys(r).sort(),['author','committer','message','signal']);const snapshot={head:oid,ref:'refs/heads/main',objectFormat:'sha1',indexDigest:'d'.repeat(64),tree:oid,commit:{oid,body:Buffer.from('secret')},author:r.author,committer:r.committer,message:r.message,fingerprint:'private',plan:{private:true}};snapshots.push(snapshot);return prepare?prepare(r,snapshot):snapshot;},
  applyCommitPreview:async(repo,r)=>{writes++;assert.ok(snapshots.includes(r.snapshot));return apply?apply(r):(r.onStart(),{head:oid,ref:'refs/heads/main',tree:oid,indexDigest:'d'.repeat(64)});},
  listLocalBranches:async()=>({branches:[]}),prepareLocalBranchSwitch:async()=>({current:{},target:{}}),switchLocalBranch:async(repo,r)=>(r.onStart(),{}),
  prepareSelectedIndexStage:async()=>({path:'selected',head:oid,index:{oid},target:{oid}}),applyIndexStage:async(repo,r)=>(r.onStart(),{}),clearHistoricalCache:()=>clears++};
 const handle=createHandler({sessions:{get:()=>{lookups++;onLookup?.();return {header:{cwd}};}}},api,4,{operationTimeoutMs:timeout,now:clock,...(ttlMs?{ttlMs}:{})});
 return {handle,root,address:{sessionId:'s',repositoryId:'r'},setCwd:v=>cwd=v,onLookup:f=>onLookup=f,writes:()=>writes,prepares:()=>prepares,clears:()=>clears,lookups:()=>lookups};
}
const discover=(f,sessionId='s')=>f.handle('vcs/repositories',{sessionId});
const payload=f=>({...f.address,author:identity(),committer:identity(),message:'Subject\u000a\u000aBody\u0009text\u000a'});
const prepare=f=>f.handle('vcs/commit-prepare',payload(f));
const confirm=(f,value,signal)=>f.handle('vcs/commit-confirm',{...f.address,token:value},signal);
const code=async promise=>(await promise).error?.code;
test('exact descriptor records reject missing, extra, symbol, inherited and accessor fields before Session lookup',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());let getters=0;
 const cases=[null,[],Object.create(payload(f)),{...payload(f),root:'/bad'},{...payload(f),path:'a'},{...payload(f),ref:'main'},{...payload(f),tree:oid},{...payload(f),OID:oid},{...payload(f),plan:{}},{...payload(f),[Symbol('x')]:1}];
 for(const key of Object.keys(payload(f))){const p=payload(f);delete p[key];cases.push(p);const q=payload(f);Object.defineProperty(q,key,{get(){getters++;return 'x';}});cases.push(q);}
 for(const field of ['author','committer']){cases.push({...payload(f),[field]:Object.create(identity())});for(const key of Object.keys(identity())){const p=payload(f);delete p[field][key];cases.push(p);const q=payload(f);Object.defineProperty(q[field],key,{get(){getters++;return 'x';}});cases.push(q);}cases.push({...payload(f),[field]:{...identity(),extra:1}},{...payload(f),[field]:{...identity(),[Symbol('x')]:1}});}
 for(const p of cases)assert.equal(await code(f.handle('vcs/commit-prepare',p)),'vcs/invalid-request');
 for(const p of [{...f.address},{...f.address,token:'A'.repeat(64)},{...f.address,token,head:oid},Object.create({...f.address,token}),{...f.address,token,[Symbol()]:1}])assert.equal(await code(f.handle('vcs/commit-confirm',p)),'vcs/invalid-request');
 const accessor={...f.address};Object.defineProperty(accessor,'token',{get(){getters++;return token;}});assert.equal(await code(f.handle('vcs/commit-confirm',accessor)),'vcs/invalid-request');
 assert.equal(getters,0);assert.equal(f.lookups(),0);assert.equal(f.prepares(),0);
});
test('identity and message grammar is strict UTF8 bounded scalar metadata',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());
 for(const field of ['author','committer'])for(const change of [{name:''},{email:' '},{name:'a<bad'},{email:'a>bad'},{name:'a\u0001'},{name:'a\u200b'},{name:'a\u2028'},{name:'\ud800'},{email:'é'.repeat(513)},{timestamp:-1},{timestamp:1.5},{timestamp:Number.MAX_SAFE_INTEGER+1},{timestamp:'1'},{timezone:'+1460'},{timezone:'-1401'},{timezone:'+1500'},{timezone:'+0860'},{timezone:'0800'},{timezone:null}])assert.equal(await code(f.handle('vcs/commit-prepare',{...payload(f),[field]:{...identity(),...change}})),'vcs/invalid-request');
 for(const message of ['', ' \u000a\u0009','x\u000d\u000a','x\u0000','x\u007f','x\u200b','x\u2028','\ud800','é'.repeat(32769),Buffer.from('message'),42])assert.equal(await code(f.handle('vcs/commit-prepare',{...payload(f),message})),'vcs/invalid-request');
 assert.equal(f.lookups(),0);await discover(f);
 for(const timezone of ['+1400','-1400','+0000','-0000'])assert.equal((await f.handle('vcs/commit-prepare',{...payload(f),author:{...identity(),timezone,timestamp:0},message:'é'.repeat(32768)})).ok,true);
});
test('snapshots are captured before first Session lookup and public projection excludes private plan and bytes',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);const p=payload(f);
 f.onLookup(()=>{p.author.name='Changed';p.committer.email='changed';p.message='Changed';p.repositoryId='other';});
 const result=await f.handle('vcs/commit-prepare',p);assert.equal(result.ok,true);assert.equal(result.value.author.name,'Explicit Browser');assert.equal(result.value.committer.email,'browser@example.test');assert.equal(result.value.message,'Subject\u000a\u000aBody\u0009text\u000a');
 assert.deepEqual(Object.keys(result.value).sort(),['action','author','commit','committer','expiresAt','head','indexDigest','message','objectFormat','ref','token','tree']);assert.deepEqual(result.value.commit,{oid});assert.equal(result.value.action,'commit');assert.match(result.value.token,/^[a-f0-9]{64}$/);f.onLookup(undefined);
 assert.equal((await confirm(f,result.value.token)).ok,true);assert.equal(f.writes(),1);assert.equal(await code(confirm(f,result.value.token)),'vcs/commit-confirmation-invalid');assert.ok(f.clears()>0);
});
test('Git-only discovery grants and token isolation prevent unauthorized writes',async t=>{
 const svn=fixture({type:'svn'});t.after(()=>svn.handle.dispose());await discover(svn);assert.equal(await code(prepare(svn)),'vcs/invalid-request');assert.equal(await code(confirm(svn,token)),'vcs/invalid-request');assert.equal(svn.prepares(),0);
 const f=fixture();t.after(()=>f.handle.dispose());assert.equal(await code(prepare(f)),'vcs/rediscover-required');await discover(f);await discover(f,'other');let p=await prepare(f);
 assert.equal(await code(f.handle('vcs/commit-confirm',{...f.address,sessionId:'other',token:p.value.token})),'vcs/commit-confirmation-invalid');assert.equal(await code(confirm(f,p.value.token)),'vcs/commit-confirmation-invalid');
 p=await prepare(f);assert.equal(await code(f.handle('vcs/commit-confirm',{...f.address,repositoryId:'r2',token:p.value.token})),'vcs/commit-confirmation-invalid');
 p=await prepare(f);assert.equal(await code(f.handle('vcs/branch-switch-confirm',{...f.address,token:p.value.token})),'vcs/branch-confirmation-invalid');assert.equal((await confirm(f,p.value.token)).ok,true);
 p=await prepare(f);f.setCwd('/changed');assert.equal(await code(confirm(f,p.value.token)),'vcs/rediscover-required');assert.equal(f.writes(),1);
});
test('rediscovery expiry disposal and grant replacement invalidate prepared commits',async t=>{
 let now=1000;const f=fixture({clock:()=>now});t.after(()=>f.handle.dispose());await discover(f);let p=await prepare(f);await discover(f);assert.equal(await code(confirm(f,p.value.token)),'vcs/commit-confirmation-invalid');p=await prepare(f);now+=60001;assert.equal(await code(confirm(f,p.value.token)),'vcs/commit-confirmation-invalid');p=await prepare(f);now+=300001;assert.equal(await code(confirm(f,p.value.token)),'vcs/rediscover-required');await discover(f);p=await prepare(f);f.handle.dispose();assert.equal(await code(confirm(f,p.value.token)),'vcs/rediscover-required');assert.equal(f.writes(),0);
});
test('prepare holds reader lock and confirm shares writer exclusion across handlers and operation kinds',async t=>{
 let finish,start;const gate=new Promise(r=>finish=r),started=new Promise(r=>start=r),root='/rpc-commit-shared-'+Math.random();
 const f=fixture({root,apply:async r=>{r.onStart();start();await gate;return {};}}),g=fixture({root});t.after(()=>{finish();f.handle.dispose();g.handle.dispose();});await discover(f);await discover(g);
 const bp=await g.handle('vcs/branch-switch-prepare',{...g.address,branch:'next'}),ip=await g.handle('vcs/index-stage-prepare',{...g.address,id:'a'.repeat(64)}),p=await prepare(f),pending=confirm(f,p.value.token);await started;
 assert.equal(await code(prepare(g)),'vcs/busy');assert.equal(await code(g.handle('vcs/branches',g.address)),'vcs/busy');assert.equal(await code(g.handle('vcs/branch-switch-confirm',{...g.address,token:bp.value.token})),'vcs/busy');assert.equal(await code(g.handle('vcs/index-stage-confirm',{...g.address,token:ip.value.token})),'vcs/busy');finish();assert.equal((await pending).ok,true);
 let release;const h=fixture({prepare:async(r,s)=>{assert.throws(()=>acquireRepositoryAccess(h.root,true),{code:'vcs/busy'});return s;}});t.after(()=>{release?.();h.handle.dispose();});await discover(h);const q=await prepare(h);assert.equal(q.ok,true);assert.equal((await confirm(h,q.value.token)).ok,true);
});
test('cancel, stale failures, adapter unknown and outer budget retain correct outcome semantics',async t=>{
 const f=fixture({apply:async()=>{throw Object.assign(Error('stale'),{code:'vcs/commit-stale'});}});t.after(()=>f.handle.dispose());await discover(f);let p=await prepare(f);assert.equal(await code(confirm(f,p.value.token)),'vcs/commit-stale');assert.equal(await code(confirm(f,p.value.token)),'vcs/commit-confirmation-invalid');
 const c=new AbortController(),g=fixture({apply:async r=>{r.onStart();c.abort();r.signal.throwIfAborted();}});t.after(()=>g.handle.dispose());await discover(g);p=await prepare(g);assert.equal(await code(confirm(g,p.value.token,c.signal)),'vcs/commit-outcome-unknown');
 const d=new AbortController(),h=fixture({apply:async()=>{d.abort();throw Object.assign(Error('append-only; inspect HEAD'),{code:'vcs/commit-outcome-unknown'});}});t.after(()=>h.handle.dispose());await discover(h);p=await prepare(h);assert.equal(await code(confirm(h,p.value.token,d.signal)),'vcs/commit-outcome-unknown');
 const j=fixture({apply:async()=>{throw Object.assign(Error('cancel'),{name:'AbortError'});}});t.after(()=>j.handle.dispose());await discover(j);p=await prepare(j);assert.equal(await code(confirm(j,p.value.token)),'vcs/cancelled');
 const k=fixture({timeout:25,apply:async r=>{r.onStart();await new Promise(resolve=>setTimeout(resolve,70));return {};}});t.after(()=>k.handle.dispose());await discover(k);p=await prepare(k);const result=await confirm(k,p.value.token);assert.equal(result.error.code,'vcs/commit-outcome-unknown');assert.match(result.error.message,/Append-only/);assert.match(result.error.message,/HEAD/);assert.equal(k.writes(),1);
 const abort=new AbortController();abort.abort();assert.equal(await code(confirm(f,token,abort.signal)),'vcs/cancelled');
});
