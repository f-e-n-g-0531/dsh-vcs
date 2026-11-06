import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../index.mjs';
import {acquireRepositoryAccess} from '../confirmed-operation.mjs';
import * as vcs from '../vcs.mjs';
import * as preview from '../tag-create-preview.mjs';

const oid='b'.repeat(40), token='c'.repeat(64), id='a'.repeat(64);
const identity=()=>({name:'Browser',email:'browser@example.test',timestamp:1730000000,timezone:'+0800'});
function fixture({type='git',root='/rpc-tag-create-'+Math.random(),apply,prepare,timeout=15000,clock=Date.now,ttlMs,maxSessions}={}){
 let cwd=root,writes=0,prepares=0,clears=0,lookups=0,onLookup;
 const snapshots=[];
 const commitSnapshot=r=>({head:oid,ref:'refs/heads/main',objectFormat:'sha1',indexDigest:id,tree:oid,previousTree:oid,parents:[oid],commit:{oid},author:r.author||identity(),committer:r.committer,message:r.message});
 const api={discoverRepositories:async()=>({repositories:[{id:'r',type,root},{id:'r2',type,root:root+'2'}],warnings:[]}),
  prepareTagCreate:async(repo,r)=>{prepares++;assert.deepEqual(repo,{type,root});assert.deepEqual(Object.keys(r).sort(),['message','name','signal','tagger']);const snapshot={name:r.name,ref:'refs/tags/'+r.name,object:{oid,body:Buffer.from('secret')},head:oid,currentRef:'refs/heads/main',targetTree:oid,tagger:r.tagger,message:r.message,messageBytes:Buffer.byteLength(r.message),planId:id,objectFormat:'sha1',fingerprint:'secret',plan:{private:true}};snapshots.push(snapshot);return prepare?prepare(r,snapshot):snapshot;},
  applyTagCreate:async(repo,r)=>{writes++;assert.deepEqual(repo,{type,root});assert.deepEqual(Object.keys(r).sort(),['assertAuthorized','onStart','signal','snapshot']);assert.ok(snapshots.includes(r.snapshot));assert.equal(r.snapshot.object.oid,oid);assert.equal(r.snapshot.tagger.name,'Browser');assert.equal(r.snapshot.message,'Release\r\n安全');assert.ok(Buffer.isBuffer(r.snapshot.object.body));return apply?apply(r):(r.onStart(),{name:r.snapshot.name,ref:r.snapshot.ref,target:{oid}});},
  prepareBranchCreate:async(repo,r)=>({name:r.name,ref:'refs/heads/'+r.name,target:{oid},head:oid,currentRef:'refs/heads/main',objectFormat:'sha1'}),applyBranchCreate:async(repo,r)=>(r.onStart(),{}),
  listLocalBranches:async()=>({branches:[]}),prepareLocalBranchSwitch:async()=>({current:{},target:{}}),switchLocalBranch:async(repo,r)=>(r.onStart(),{}),
  prepareSelectedIndexStage:async()=>({path:'selected',head:oid,index:{oid},target:{oid}}),applyIndexStage:async(repo,r)=>(r.onStart(),{}),
  prepareSelectedIndexUnstage:async()=>({path:'selected',head:oid,index:{oid},target:{oid}}),applyIndexUnstage:async(repo,r)=>(r.onStart(),{}),
  prepareCommitPreview:async(repo,r)=>commitSnapshot(r),applyCommitPreview:async(repo,r)=>(r.onStart(),{}),
  prepareAmendPreview:async(repo,r)=>commitSnapshot(r),applyAmendPreview:async(repo,r)=>(r.onStart(),{}),
  clearHistoricalCache:()=>clears++};
 const handle=createHandler({sessions:{get:()=>{lookups++;onLookup?.();return {header:{cwd}};}}},api,4,{operationTimeoutMs:timeout,now:clock,...(ttlMs?{ttlMs}:{}),...(maxSessions?{maxSessions}:{})});
 return {handle,api,root,address:{sessionId:'s',repositoryId:'r'},setCwd:v=>cwd=v,onLookup:f=>onLookup=f,writes:()=>writes,prepares:()=>prepares,clears:()=>clears,lookups:()=>lookups};
}
const discover=(f,sessionId='s')=>f.handle('vcs/repositories',{sessionId});
const payload=f=>({...f.address,name:'feature/安全',tagger:identity(),message:'Release\r\n安全'});
const prepare=f=>f.handle('vcs/tag-create-prepare',payload(f));
const confirm=(f,value,signal)=>f.handle('vcs/tag-create-confirm',{...f.address,token:value},signal);
const code=async promise=>(await promise).error?.code;
const gate=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('vcs exports the existing tag creation preview and apply authority',()=>{
 assert.equal(vcs.prepareTagCreate,preview.prepareTagCreate);assert.equal(vcs.applyTagCreate,preview.applyTagCreate);
});
test('both RPCs require exact plain own descriptor records before Session lookup; getters never run',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());let getters=0;
 for(const endpoint of ['vcs/tag-create-prepare','vcs/tag-create-confirm']){
  const valid=endpoint.endsWith('prepare')?payload(f):{...f.address,token};
  const cases=[null,[],Object.create(valid),Object.assign(Object.create({extra:1}),valid),{...valid,[Symbol()]:1}];
  for(const key of ['root','path','ref','oid','OID','head','target','snapshot','options','checkout','switch','force','type','object','objectFormat','sign','signing','gpgSign'])cases.push({...valid,[key]:'bad'});
  const nonenumerable={...valid};Object.defineProperty(nonenumerable,'hidden',{value:1});cases.push(nonenumerable);
  for(const key of Object.keys(valid)){const p={...valid};delete p[key];cases.push(p);const q={...valid};Object.defineProperty(q,key,{get(){getters++;return valid[key];}});cases.push(q);}
  for(const p of cases)assert.equal(await code(f.handle(endpoint,p)),'vcs/invalid-request');
 }
 for(const token of ['',null,42,'A'.repeat(64),'a'.repeat(63)])assert.equal(await code(confirm(f,token)),'vcs/invalid-request');
 for(const sessionId of ['',null,'../x','x\\y','x/','a'.repeat(257)])assert.equal(await code(f.handle('vcs/tag-create-prepare',{...payload(f),sessionId})),'vcs/invalid-request');
 for(const repositoryId of ['',null,{},'x'.repeat(1025)])assert.equal(await code(f.handle('vcs/tag-create-confirm',{...f.address,token,repositoryId})),'vcs/invalid-request');
 assert.equal(getters,0);assert.equal(f.lookups(),0);assert.equal(f.prepares(),0);
});
test('nested tagger descriptors and encoder constraints are validated before lookup or budget',async t=>{
 const f=fixture({timeout:0});t.after(()=>f.handle.dispose());let getters=0;
 const valid=identity(),cases=[null,[],Buffer.from('tagger'),Object.create(valid),Object.assign(Object.create({inherited:1}),valid),{...valid,[Symbol()]:1},{...valid,extra:1}];
 for(const key of Object.keys(valid)){
  const missing={...valid};delete missing[key];cases.push(missing);
  const accessor={...valid};Object.defineProperty(accessor,key,{get(){getters++;return valid[key];}});cases.push(accessor);
 }
 for(const tagger of cases)assert.equal(await code(f.handle('vcs/tag-create-prepare',{...payload(f),tagger})),'vcs/invalid-request');
 for(const message of [undefined,null,42,Buffer.from('release'),'', ' ', '\ud800','x'.repeat(65537),'é'.repeat(32769),'unsafe\0','-----BEGIN PGP SIGNATURE-----'])assert.equal(await code(f.handle('vcs/tag-create-prepare',{...payload(f),message})),'vcs/invalid-request');
 for(const fields of [{name:''},{email:'bad>email'},{timestamp:-1},{timestamp:1.5},{timezone:'+1460'},{timezone:'+1401'}])assert.equal(await code(f.handle('vcs/tag-create-prepare',{...payload(f),tagger:{...valid,...fields}})),'vcs/invalid-request');
 assert.equal(getters,0);assert.equal(f.lookups(),0);assert.equal(f.prepares(),0);assert.equal(f.writes(),0);
 // Invalid operation budget proves the valid request never dispatches; invalid input still wins.
 assert.equal(await code(prepare(f)),'vcs/operation-failed');assert.equal(await code(confirm(f,token)),'vcs/tag-create-outcome-unknown');assert.equal(f.lookups(),0);assert.equal(f.writes(),0);
 const abort=new AbortController();abort.abort();assert.equal(await code(f.handle('vcs/tag-create-confirm',{...f.address,token:'bad'},abort.signal)),'vcs/invalid-request');
});

test('portable strict UTF8 tag grammar and component/total byte bounds match preview',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());
 const invalidNames=['',null,42,{},'@','HEAD','head','HeAd','-branch','refs/heads/x','a b','a\t','a\n','a\r','a\0','a\u007f','a\u0085','a\u200b','a~b','a^b','a:b','a?b','a*b','a[b','a\\b','a<b','a>b','a"b','a|b','a..b','a@{b','/a','a/','a//b','.a','a/.b','a.','a.lock','a.LoCk','con','a/COM1.txt','nul','LPT9','\ud800','é'.repeat(128),'x'.repeat(256),['x'.repeat(250),'x'.repeat(250),'x'.repeat(250),'x'.repeat(248)].join('/')];
 for(const name of invalidNames)assert.equal(await code(f.handle('vcs/tag-create-prepare',{...payload(f),name})),'vcs/invalid-request',String(name));
 assert.equal(f.lookups(),0);await discover(f);
 for(const name of ['feature/安全','a'.repeat(255),'é'.repeat(127)+'a',['x'.repeat(250),'x'.repeat(250),'x'.repeat(250),'x'.repeat(247)].join('/'),'constructor','HEAD-topic'])assert.equal((await f.handle('vcs/tag-create-prepare',{...payload(f),name})).ok,true,name);
});
test('prelookup snapshots retain names addresses and token; projection never returns private authority',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);const p=payload(f);
 f.onLookup(()=>{p.name='changed';p.repositoryId='other';p.sessionId='other';p.tagger.name='changed';p.message='changed';});
 const result=await f.handle('vcs/tag-create-prepare',p);assert.equal(result.ok,true);assert.equal(result.value.name,'feature/安全');assert.equal(result.value.tagger.name,'Browser');assert.equal(result.value.message,'Release\r\n安全');
 assert.deepEqual(Object.keys(result.value).sort(),['action','currentRef','expiresAt','head','message','messageBytes','name','object','objectFormat','planId','ref','tagger','targetTree','token']);assert.equal(result.value.action,'tag-create');assert.deepEqual(result.value.object,{oid});assert.equal(JSON.stringify(result).includes('secret'),false);assert.match(result.value.token,/^[a-f0-9]{64}$/);
 result.value.object.oid='f'.repeat(40);result.value.tagger.name='public mutation';result.value.message='public mutation';
 const c={...f.address,token:result.value.token};f.onLookup(()=>{c.token=token;c.repositoryId='bad';});
 assert.equal((await f.handle('vcs/tag-create-confirm',c)).ok,true);f.onLookup(undefined);assert.equal(f.writes(),1);assert.equal(await code(confirm(f,result.value.token)),'vcs/tag-create-confirmation-invalid');assert.ok(f.clears()>0);
 const nullRecord=Object.assign(Object.create(null),payload(f));assert.equal((await f.handle('vcs/tag-create-prepare',nullRecord)).ok,true);
});
test('Git grants only, token session/repository binding and single use',async t=>{
 const svn=fixture({type:'svn'});t.after(()=>svn.handle.dispose());await discover(svn);assert.equal(await code(prepare(svn)),'vcs/invalid-request');assert.equal(await code(confirm(svn,token)),'vcs/invalid-request');assert.equal(svn.prepares(),0);assert.equal(svn.writes(),0);
 const f=fixture();t.after(()=>f.handle.dispose());assert.equal(await code(prepare(f)),'vcs/rediscover-required');await discover(f);await discover(f,'other');let p=await prepare(f);
 assert.equal(await code(f.handle('vcs/tag-create-confirm',{...f.address,sessionId:'other',token:p.value.token})),'vcs/tag-create-confirmation-invalid');assert.equal(await code(confirm(f,p.value.token)),'vcs/tag-create-confirmation-invalid');
 p=await prepare(f);assert.equal(await code(f.handle('vcs/tag-create-confirm',{...f.address,repositoryId:'r2',token:p.value.token})),'vcs/tag-create-confirmation-invalid');
 p=await prepare(f);f.setCwd('/changed');assert.equal(await code(confirm(f,p.value.token)),'vcs/rediscover-required');assert.equal(f.writes(),0);
});
const otherKinds=[
 ['branch-create',{name:'branch'},'vcs/branch-create-confirmation-invalid'],
 ['branch-switch',{branch:'next'},'vcs/branch-confirmation-invalid'],
 ['commit',{author:identity(),committer:identity(),message:'Subject'},'vcs/commit-confirmation-invalid'],
 ['amend',{committer:identity(),message:'Subject'},'vcs/amend-confirmation-invalid'],
 ['index-stage',{id},'vcs/index-confirmation-invalid'],
 ['index-unstage',{id},'vcs/index-confirmation-invalid'],
];
for(const [kind,fields,invalid] of otherKinds)test('token isolation both directions: '+kind,async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);
 const p=await prepare(f),q=await f.handle('vcs/'+kind+'-prepare',{...f.address,...fields});assert.equal(q.ok,true);
 assert.equal(await code(f.handle('vcs/'+kind+'-confirm',{...f.address,token:p.value.token})),invalid);assert.equal((await confirm(f,p.value.token)).ok,true);
 assert.equal(await code(confirm(f,q.value.token)),'vcs/tag-create-confirmation-invalid');assert.equal((await f.handle('vcs/'+kind+'-confirm',{...f.address,token:q.value.token})).ok,true);
});
test('rediscovery, token/grant expiry, eviction and disposal invalidate tokens and clear history',async t=>{
 let now=1000;const f=fixture({clock:()=>now,maxSessions:1});t.after(()=>f.handle.dispose());await discover(f);let p=await prepare(f),clears=f.clears();await discover(f);assert.ok(f.clears()>clears);assert.equal(await code(confirm(f,p.value.token)),'vcs/tag-create-confirmation-invalid');
 p=await prepare(f);now+=60001;assert.equal(await code(confirm(f,p.value.token)),'vcs/tag-create-confirmation-invalid');
 p=await prepare(f);now+=300001;assert.equal(await code(confirm(f,p.value.token)),'vcs/rediscover-required');await discover(f);
 p=await prepare(f);await discover(f,'other');assert.equal(await code(confirm(f,p.value.token)),'vcs/rediscover-required');await discover(f);assert.equal(await code(confirm(f,p.value.token)),'vcs/tag-create-confirmation-invalid');
 p=await prepare(f);clears=f.clears();f.handle.dispose();assert.ok(f.clears()>clears);assert.equal(await code(confirm(f,p.value.token)),'vcs/rediscover-required');assert.equal(f.writes(),0);
});
test('prepare reader and confirm writer share exclusion across handlers and all write kinds',async t=>{
 const started=gate(),finish=gate(),root='/rpc-branch-shared-'+Math.random();
 const f=fixture({root,apply:async r=>{r.onStart();started.resolve();await finish.promise;return {};}}),g=fixture({root});
 t.after(()=>{finish.resolve();f.handle.dispose();g.handle.dispose();});await discover(f);await discover(g);
 const others=[];for(const [kind,fields] of otherKinds){const q=await g.handle('vcs/'+kind+'-prepare',{...g.address,...fields});assert.equal(q.ok,true);others.push([kind,q.value.token]);}
 const q=await prepare(g),p=await prepare(f),pending=confirm(f,p.value.token);await started.promise;
 assert.equal(await code(prepare(g)),'vcs/busy');assert.equal(await code(g.handle('vcs/branches',g.address)),'vcs/busy');assert.equal(await code(confirm(g,q.value.token)),'vcs/busy');
 for(const [kind,token] of others)assert.equal(await code(g.handle('vcs/'+kind+'-confirm',{...g.address,token})),'vcs/busy');
 finish.resolve();assert.equal((await pending).ok,true);
 const h=fixture({prepare:async(r,s)=>{assert.throws(()=>acquireRepositoryAccess(h.root,true),{code:'vcs/busy'});return s;}});t.after(()=>h.handle.dispose());await discover(h);assert.equal((await prepare(h)).ok,true);
 const release=acquireRepositoryAccess(h.root);try{const p=await prepare(h);assert.equal(await code(confirm(h,p.value.token)),'vcs/busy');}finally{release();}
});
for(const [kind,fields] of otherKinds)test('existing '+kind+' writer blocks tag creation reader/writer',async t=>{
 const f=fixture();t.after(()=>f.handle.dispose());await discover(f);const p=await prepare(f),started=gate(),finish=gate();
 const applyName={'branch-create':'applyBranchCreate',commit:'applyCommitPreview',amend:'applyAmendPreview','branch-switch':'switchLocalBranch','index-stage':'applyIndexStage','index-unstage':'applyIndexUnstage'}[kind];
 f.api[applyName]=async(repo,r)=>{r.onStart();started.resolve();await finish.promise;return {};};
 t.after(()=>finish.resolve());const q=await f.handle('vcs/'+kind+'-prepare',{...f.address,...fields});const pending=f.handle('vcs/'+kind+'-confirm',{...f.address,token:q.value.token});await started.promise;
 assert.equal(await code(prepare(f)),'vcs/busy');assert.equal(await code(confirm(f,p.value.token)),'vcs/busy');finish.resolve();assert.equal((await pending).ok,true);
});
test('lost grants before preparation completes issue no token',async t=>{
 const entered=gate(),finish=gate();const f=fixture({prepare:async(r,s)=>{entered.resolve();await finish.promise;return s;}});t.after(()=>{finish.resolve();f.handle.dispose();});
 await discover(f);const pending=prepare(f);await entered.promise;await discover(f);finish.resolve();assert.equal(await code(pending),'vcs/rediscover-required');assert.equal(f.writes(),0);
});
test('grant loss after start is unknown and capacity evicts oldest tag capability',async t=>{
 const f=fixture({apply:async r=>{r.onStart();f.setCwd('/changed');return {};}});t.after(()=>f.handle.dispose());await discover(f);let p=await prepare(f);assert.equal(await code(confirm(f,p.value.token)),'vcs/tag-create-outcome-unknown');
 const g=fixture();t.after(()=>g.handle.dispose());await discover(g);p=await prepare(g);for(let i=0;i<32;i++)assert.equal((await prepare(g)).ok,true);assert.equal(await code(confirm(g,p.value.token)),'vcs/tag-create-confirmation-invalid');
});
test('prestart cancellation/staleness, poststart unknown and outer lifetime warning never imply rollback',async t=>{
 const f=fixture({apply:async()=>{throw Object.assign(Error('stale'),{code:'vcs/tag-create-stale'});}});t.after(()=>f.handle.dispose());await discover(f);let p=await prepare(f);assert.equal(await code(confirm(f,p.value.token)),'vcs/tag-create-stale');assert.equal(await code(confirm(f,p.value.token)),'vcs/tag-create-confirmation-invalid');
 const c=new AbortController(),g=fixture({apply:async r=>{r.onStart();c.abort();r.signal.throwIfAborted();}});t.after(()=>g.handle.dispose());await discover(g);p=await prepare(g);assert.equal(await code(confirm(g,p.value.token,c.signal)),'vcs/tag-create-outcome-unknown');
 const d=new AbortController(),h=fixture({apply:async()=>{d.abort();throw Object.assign(Error('inspect refs and HEAD'),{code:'vcs/tag-create-outcome-unknown'});}});t.after(()=>h.handle.dispose());await discover(h);p=await prepare(h);assert.equal(await code(confirm(h,p.value.token,d.signal)),'vcs/tag-create-outcome-unknown');
 const j=fixture({apply:async()=>{throw Object.assign(Error('cancel'),{name:'AbortError'});}});t.after(()=>j.handle.dispose());await discover(j);p=await prepare(j);assert.equal(await code(confirm(j,p.value.token)),'vcs/cancelled');
 const k=fixture({timeout:25,apply:async r=>{r.onStart();await new Promise(resolve=>setTimeout(resolve,70));return {};}});t.after(()=>k.handle.dispose());await discover(k);p=await prepare(k);const result=await confirm(k,p.value.token);assert.equal(result.error.code,'vcs/tag-create-outcome-unknown');assert.match(result.error.message,/refs.*HEAD/);assert.match(result.error.message,/Never automatically delete objects or refs, retry, or roll back/);assert.equal(k.writes(),1);assert.equal(await code(confirm(k,p.value.token)),'vcs/tag-create-confirmation-invalid');
 const abort=new AbortController();abort.abort();p=await prepare(f);assert.equal(await code(confirm(f,p.value.token,abort.signal)),'vcs/cancelled');assert.equal(await code(confirm(f,p.value.token)),'vcs/tag-create-stale');
});
