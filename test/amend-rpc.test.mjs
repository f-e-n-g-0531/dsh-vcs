import test from 'node:test';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {git} from '../local-command.mjs';
import assert from 'node:assert/strict';
import {createHandler} from '../index.mjs';
import {acquireRepositoryAccess} from '../confirmed-operation.mjs';
const oid='b'.repeat(40), token='c'.repeat(64);
const identity=()=>({name:'Explicit Browser',email:'browser@example.test',timestamp:1730000000,timezone:'+0800'});
function fixture({type='git',root='/rpc-amend-'+Math.random(),apply,prepare,timeout=15000,clock=Date.now,ttlMs,maxSessions=32}={}){
 let cwd=root,writes=0,prepares=0,clears=0,lookups=0,onLookup;
 const snapshots=[];
 const api={discoverRepositories:async()=>({repositories:[{id:'r',type,root},{id:'r2',type,root:root+'2'}],warnings:[]}),
  prepareAmendPreview:async(repo,r)=>{prepares++;assert.deepEqual(Object.keys(r).sort(),['committer','message','signal']);const snapshot={head:oid,ref:'refs/heads/main',objectFormat:'sha1',indexDigest:'d'.repeat(64),previousTree:oid,parents:[],tree:oid,commit:{oid,body:Buffer.from('secret')},author:identity(),committer:r.committer,message:r.message,fingerprint:'private',plan:{private:true}};snapshots.push(snapshot);return prepare?prepare(r,snapshot):snapshot;},
  applyAmendPreview:async(repo,r)=>{writes++;assert.ok(snapshots.includes(r.snapshot));return apply?apply(r):(r.onStart(),{head:oid,ref:'refs/heads/main',tree:oid,indexDigest:'d'.repeat(64)});},
  prepareCommitPreview:async(repo,r)=>({head:oid,ref:'refs/heads/main',objectFormat:'sha1',indexDigest:'d'.repeat(64),tree:oid,commit:{oid},author:r.author,committer:r.committer,message:r.message}),applyCommitPreview:async(repo,r)=>(r.onStart(),{}),
  listLocalBranches:async()=>({branches:[]}),prepareLocalBranchSwitch:async()=>({current:{},target:{}}),switchLocalBranch:async(repo,r)=>(r.onStart(),{}),
  prepareSelectedIndexStage:async()=>({path:'selected',head:oid,index:{oid},target:{oid}}),applyIndexStage:async(repo,r)=>(r.onStart(),{}),clearHistoricalCache:()=>clears++};
 const handle=createHandler({sessions:{get:()=>{lookups++;onLookup?.();return {header:{cwd}};}}},api,4,{operationTimeoutMs:timeout,now:clock,maxSessions,...(ttlMs?{ttlMs}:{})});
 return {handle,root,address:{sessionId:'s',repositoryId:'r'},setCwd:v=>cwd=v,onLookup:f=>onLookup=f,writes:()=>writes,prepares:()=>prepares,clears:()=>clears,lookups:()=>lookups};
}
const discover=(f,sessionId='s')=>f.handle('vcs/repositories',{sessionId});
const payload=f=>({...f.address,committer:identity(),message:'Subject\u000a\u000aBody\u0009text\u000a'});
const prepare=f=>f.handle('vcs/amend-prepare',payload(f));
const confirm=(f,value,signal)=>f.handle('vcs/amend-confirm',{...f.address,token:value},signal);
const code=async promise=>(await promise).error?.code;
test('exact descriptor records reject missing, extra, symbol, inherited and accessor fields before Session lookup',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());let getters=0;
 const cases=[null,[],Object.create(payload(f)),{...payload(f),author:identity()},{...payload(f),parents:[]},{...payload(f),head:oid},{...payload(f),root:'/bad'},{...payload(f),path:'a'},{...payload(f),ref:'main'},{...payload(f),tree:oid},{...payload(f),OID:oid},{...payload(f),plan:{}},{...payload(f),[Symbol('x')]:1}];
 for(const key of Object.keys(payload(f))){const p=payload(f);delete p[key];cases.push(p);const q=payload(f);Object.defineProperty(q,key,{get(){getters++;return 'x';}});cases.push(q);}
 for(const field of ['committer']){cases.push({...payload(f),[field]:Object.create(identity())});for(const key of Object.keys(identity())){const p=payload(f);delete p[field][key];cases.push(p);const q=payload(f);Object.defineProperty(q[field],key,{get(){getters++;return 'x';}});cases.push(q);}cases.push({...payload(f),[field]:{...identity(),extra:1}},{...payload(f),[field]:{...identity(),[Symbol('x')]:1}});}
 for(const p of cases)assert.equal(await code(f.handle('vcs/amend-prepare',p)),'vcs/invalid-request');
 for(const p of [{...f.address},{...f.address,token:'A'.repeat(64)},{...f.address,token,head:oid},Object.create({...f.address,token}),{...f.address,token,[Symbol()]:1}])assert.equal(await code(f.handle('vcs/amend-confirm',p)),'vcs/invalid-request');
 const accessor={...f.address};Object.defineProperty(accessor,'token',{get(){getters++;return token;}});assert.equal(await code(f.handle('vcs/amend-confirm',accessor)),'vcs/invalid-request');
 assert.equal(getters,0);assert.equal(f.lookups(),0);assert.equal(f.prepares(),0);
});
test('identity and message grammar is strict UTF8 bounded scalar metadata',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());
 for(const field of ['committer'])for(const change of [{name:''},{email:' '},{name:'a<bad'},{email:'a>bad'},{name:'a\u0001'},{name:'a\u200b'},{name:'a\u2028'},{name:'\ud800'},{email:'é'.repeat(513)},{timestamp:-1},{timestamp:1.5},{timestamp:Number.MAX_SAFE_INTEGER+1},{timestamp:'1'},{timezone:'+1460'},{timezone:'-1401'},{timezone:'+1500'},{timezone:'+0860'},{timezone:'0800'},{timezone:null}])assert.equal(await code(f.handle('vcs/amend-prepare',{...payload(f),[field]:{...identity(),...change}})),'vcs/invalid-request');
 for(const message of ['', ' \u000a\u0009','x\u000d\u000a','x\u0000','x\u007f','x\u200b','x\u2028','\ud800','é'.repeat(32769),Buffer.from('message'),42])assert.equal(await code(f.handle('vcs/amend-prepare',{...payload(f),message})),'vcs/invalid-request');
 assert.equal(f.lookups(),0);await discover(f);
 for(const timezone of ['+1400','-1400','+0000','-0000'])assert.equal((await f.handle('vcs/amend-prepare',{...payload(f),committer:{...identity(),timezone,timestamp:0},message:'é'.repeat(32768)})).ok,true);
});
test('snapshots are captured before first Session lookup and public projection excludes private plan and bytes',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);const p=payload(f);
 f.onLookup(()=>{p.committer.email='changed';p.message='Changed';p.repositoryId='other';});
 const result=await f.handle('vcs/amend-prepare',p);assert.equal(result.ok,true);assert.equal(result.value.author.name,'Explicit Browser');assert.equal(result.value.committer.email,'browser@example.test');assert.equal(result.value.message,'Subject\u000a\u000aBody\u0009text\u000a');
 assert.deepEqual(Object.keys(result.value).sort(),['action','author','commit','committer','expiresAt','head','indexDigest','message','objectFormat','parents','previousTree','ref','token','tree']);assert.deepEqual(result.value.commit,{oid});assert.equal(result.value.action,'amend');assert.match(result.value.token,/^[a-f0-9]{64}$/);f.onLookup(undefined);
 assert.equal((await confirm(f,result.value.token)).ok,true);assert.equal(f.writes(),1);assert.equal(await code(confirm(f,result.value.token)),'vcs/amend-confirmation-invalid');assert.ok(f.clears()>0);
});
test('Git-only discovery grants and token isolation prevent unauthorized writes',async t=>{
 const svn=fixture({type:'svn'});t.after(()=>svn.handle.dispose());await discover(svn);assert.equal(await code(prepare(svn)),'vcs/invalid-request');assert.equal(await code(confirm(svn,token)),'vcs/invalid-request');assert.equal(svn.prepares(),0);
 const f=fixture();t.after(()=>f.handle.dispose());assert.equal(await code(prepare(f)),'vcs/rediscover-required');await discover(f);await discover(f,'other');let p=await prepare(f);
 assert.equal(await code(f.handle('vcs/amend-confirm',{...f.address,sessionId:'other',token:p.value.token})),'vcs/amend-confirmation-invalid');assert.equal(await code(confirm(f,p.value.token)),'vcs/amend-confirmation-invalid');
 p=await prepare(f);assert.equal(await code(f.handle('vcs/amend-confirm',{...f.address,repositoryId:'r2',token:p.value.token})),'vcs/amend-confirmation-invalid');
 p=await prepare(f);assert.equal(await code(f.handle('vcs/branch-switch-confirm',{...f.address,token:p.value.token})),'vcs/branch-confirmation-invalid');assert.equal((await confirm(f,p.value.token)).ok,true);
 p=await prepare(f);f.setCwd('/changed');assert.equal(await code(confirm(f,p.value.token)),'vcs/rediscover-required');assert.equal(f.writes(),1);
});
test('rediscovery expiry disposal and grant replacement invalidate prepared amends',async t=>{
 let now=1000;const f=fixture({clock:()=>now});t.after(()=>f.handle.dispose());await discover(f);let p=await prepare(f);await discover(f);assert.equal(await code(confirm(f,p.value.token)),'vcs/amend-confirmation-invalid');p=await prepare(f);now+=60001;assert.equal(await code(confirm(f,p.value.token)),'vcs/amend-confirmation-invalid');p=await prepare(f);now+=300001;assert.equal(await code(confirm(f,p.value.token)),'vcs/rediscover-required');await discover(f);p=await prepare(f);f.handle.dispose();assert.equal(await code(confirm(f,p.value.token)),'vcs/rediscover-required');assert.equal(f.writes(),0);
});
test('prepare holds reader lock and confirm shares writer exclusion across handlers and operation kinds',async t=>{
 let finish,start;const gate=new Promise(r=>finish=r),started=new Promise(r=>start=r),root='/rpc-amend-shared-'+Math.random();
 const f=fixture({root,apply:async r=>{r.onStart();start();await gate;return {};}}),g=fixture({root});t.after(()=>{finish();f.handle.dispose();g.handle.dispose();});await discover(f);await discover(g);
 const bp=await g.handle('vcs/branch-switch-prepare',{...g.address,branch:'next'}),ip=await g.handle('vcs/index-stage-prepare',{...g.address,id:'a'.repeat(64)}),p=await prepare(f),pending=confirm(f,p.value.token);await started;
 assert.equal(await code(prepare(g)),'vcs/busy');assert.equal(await code(g.handle('vcs/branches',g.address)),'vcs/busy');assert.equal(await code(g.handle('vcs/branch-switch-confirm',{...g.address,token:bp.value.token})),'vcs/busy');assert.equal(await code(g.handle('vcs/index-stage-confirm',{...g.address,token:ip.value.token})),'vcs/busy');finish();assert.equal((await pending).ok,true);
 let release;const h=fixture({prepare:async(r,s)=>{assert.throws(()=>acquireRepositoryAccess(h.root,true),{code:'vcs/busy'});return s;}});t.after(()=>{release?.();h.handle.dispose();});await discover(h);const q=await prepare(h);assert.equal(q.ok,true);assert.equal((await confirm(h,q.value.token)).ok,true);
});
test('cancel, stale failures, adapter unknown and outer budget retain correct outcome semantics',async t=>{
 const f=fixture({apply:async()=>{throw Object.assign(Error('stale'),{code:'vcs/amend-stale'});}});t.after(()=>f.handle.dispose());await discover(f);let p=await prepare(f);assert.equal(await code(confirm(f,p.value.token)),'vcs/amend-stale');assert.equal(await code(confirm(f,p.value.token)),'vcs/amend-confirmation-invalid');
 const c=new AbortController(),g=fixture({apply:async r=>{r.onStart();c.abort();r.signal.throwIfAborted();}});t.after(()=>g.handle.dispose());await discover(g);p=await prepare(g);assert.equal(await code(confirm(g,p.value.token,c.signal)),'vcs/amend-outcome-unknown');
 const d=new AbortController(),h=fixture({apply:async()=>{d.abort();throw Object.assign(Error('append-only; inspect HEAD'),{code:'vcs/amend-outcome-unknown'});}});t.after(()=>h.handle.dispose());await discover(h);p=await prepare(h);assert.equal(await code(confirm(h,p.value.token,d.signal)),'vcs/amend-outcome-unknown');
 const j=fixture({apply:async()=>{throw Object.assign(Error('cancel'),{name:'AbortError'});}});t.after(()=>j.handle.dispose());await discover(j);p=await prepare(j);assert.equal(await code(confirm(j,p.value.token)),'vcs/cancelled');
 const k=fixture({timeout:25,apply:async r=>{r.onStart();await new Promise(resolve=>setTimeout(resolve,70));return {};}});t.after(()=>k.handle.dispose());await discover(k);p=await prepare(k);const result=await confirm(k,p.value.token);assert.equal(result.error.code,'vcs/amend-outcome-unknown');assert.match(result.error.message,/Append-only/);assert.match(result.error.message,/HEAD and the index/);assert.match(result.error.message,/rewrites history/);assert.equal(k.writes(),1);
 const abort=new AbortController();abort.abort();assert.equal(await code(confirm(f,token,abort.signal)),'vcs/cancelled');
});

test('confirm snapshots token before lookup and read exclusion burns without dispatch',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);let p=await prepare(f);
 const address={...f.address,token:p.value.token};f.onLookup(()=>{address.token=token;address.repositoryId='other';});
 assert.equal((await f.handle('vcs/amend-confirm',address)).ok,true);f.onLookup(undefined);
 p=await prepare(f);const release=acquireRepositoryAccess(f.root);
 try{assert.equal(await code(confirm(f,p.value.token)),'vcs/busy');}finally{release();}
 assert.equal(f.writes(),1);assert.equal(await code(confirm(f,p.value.token)),'vcs/amend-confirmation-invalid');
});
test('ordinary commit and amend capabilities cannot cross either endpoint',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);
 const a=await prepare(f),c=await f.handle('vcs/commit-prepare',{...payload(f),author:identity()});
 assert.equal(a.ok,true);assert.equal(c.ok,true);
 assert.equal(await code(f.handle('vcs/commit-confirm',{...f.address,token:a.value.token})),'vcs/commit-confirmation-invalid');
 assert.equal(await code(confirm(f,c.value.token)),'vcs/amend-confirmation-invalid');
 assert.equal((await confirm(f,a.value.token)).ok,true);
 assert.equal((await f.handle('vcs/commit-confirm',{...f.address,token:c.value.token})).ok,true);
});
test('grant eviction and token capacity eviction clear amend capabilities',async t=>{
 const f=fixture({maxSessions:1});t.after(()=>f.handle.dispose());await discover(f);let p=await prepare(f),clears=f.clears();
 await discover(f,'other');assert.ok(f.clears()>clears);assert.equal(await code(confirm(f,p.value.token)),'vcs/rediscover-required');
 await discover(f);p=await prepare(f);for(let i=0;i<32;i++)assert.equal((await prepare(f)).ok,true);
 assert.equal(await code(confirm(f,p.value.token)),'vcs/amend-confirmation-invalid');assert.equal(f.writes(),0);
});
test('predispatch cancellation leaves a valid token usable and started grant loss is unknown',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);const p=await prepare(f),abort=new AbortController();abort.abort();
 assert.equal(await code(confirm(f,p.value.token,abort.signal)),'vcs/cancelled');assert.equal(f.writes(),0);assert.equal((await confirm(f,p.value.token)).ok,true);
 const g=fixture({apply:async r=>{r.onStart();g.setCwd('/changed');return {};}});t.after(()=>g.handle.dispose());await discover(g);const q=await prepare(g);
 const result=await confirm(g,q.value.token);assert.equal(result.error.code,'vcs/amend-outcome-unknown');assert.match(result.error.message,/rewrites history/);assert.match(result.error.message,/Append-only/);assert.match(result.error.message,/HEAD and the index/);
});
test('actual default Host amend preserves original author and parents plus Index and Work',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'amend-rpc-golden-'));
 t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),spawn=cp.spawn;
 cp.spawn=(c,a,o)=>spawn(c,a,{...o,env:{...o.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'absent-global')}});
 syncBuiltinESMExports();t.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
 const run=(...a)=>git(root,a);await run('init');
 for(const[k,v]of [['user.name','T'],['user.email','t@x'],['core.autocrlf','false']])await run('config',k,v);
 await writeFile(path.join(root,'a'),'base\n');await run('add','a');await run('commit','-m','base');
 await writeFile(path.join(root,'a'),'staged\n');await run('add','a');
 const tree=(await run('write-tree')).toString().trim();await writeFile(path.join(root,'a'),'work only\n');
 const original=(await run('cat-file','commit','HEAD')).toString();
 const head=(await run('rev-parse','HEAD')).toString().trim(),index=await readFile(path.join(root,'.git','index'));
 const identity={name:'Preview',email:'p@x',timestamp:1,timezone:'+0000'};
 const handle=createHandler({sessions:{get:()=>({header:{cwd:root}})}});t.after(()=>handle.dispose());
 const call=async(e,p)=>{const response=await handle(e,{sessionId:'s',...p});assert.equal(response.ok,true,JSON.stringify({e,response}));return response.value;};
 const found=await call('vcs/repositories',{}),repositoryId=found.repositories.find(r=>r.type==='git').id;
 const preview=await call('vcs/amend-prepare',{repositoryId,committer:identity,message:'new commit'});
 assert.equal(preview.tree,tree);assert.equal(preview.head,head);
 assert.deepEqual(await readFile(path.join(root,'.git','index')),index);
 const result=await call('vcs/amend-confirm',{repositoryId,token:preview.token});
 assert.equal(result.head,preview.commit.oid);
 assert.equal((await run('rev-parse','HEAD^{tree}')).toString().trim(),tree);
 const amended=(await run('cat-file','commit','HEAD')).toString();
 assert.equal(amended.split('\n').find(l=>l.startsWith('author ')),original.split('\n').find(l=>l.startsWith('author ')));
 assert.deepEqual(amended.split('\n').filter(l=>l.startsWith('parent ')),original.split('\n').filter(l=>l.startsWith('parent ')));
 assert.notEqual(result.head,head);
 assert.equal(preview.previousTree,(await run('rev-parse',head+'^{tree}')).toString().trim());
 assert.equal((await handle('vcs/amend-confirm',{sessionId:'s',repositoryId,token:preview.token})).error.code,'vcs/amend-confirmation-invalid');
 assert.deepEqual(await readFile(path.join(root,'.git','index')),index);
 assert.equal((await readFile(path.join(root,'a'))).toString(),'work only\n');
});
