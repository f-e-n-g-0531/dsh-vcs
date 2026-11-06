import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {git} from '../local-command.mjs';
import {prepareCommitPreview,consumeCommitPreview,applyCommitPreview} from '../commit-preview.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
const person={name:'Confirm Test',email:'confirm@example.invalid',timestamp:1700000000,timezone:'+0800'};
const inputs=()=>({author:{...person},committer:{...person},message:'Only staged\n'});
const spawn=cp.spawn,open=fs.open;let observe,opened;
cp.spawn=(command,args,options)=>{const child=spawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-confirm-no-global')}});if(command==='git')observe?.(args,child);return child;};
fs.open=async(...args)=>{opened?.push(args[0]);return open(...args);};syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;fs.open=open;syncBuiltinESMExports();});
test.afterEach(()=>{observe=opened=undefined;});
async function fixture(t,format='sha1'){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-confirm-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const repo={type:'git',root},file=(...p)=>path.join(root,...p),run=(...args)=>git(root,args);
 await run('init','--object-format='+format);await run('config','user.name','Confirm');await run('config','user.email','confirm@x');await run('config','core.autocrlf','false');
 await fs.mkdir(file('dir'));await fs.writeFile(file('dir','a'),'base\n');await run('add','.');await run('-c','commit.gpgsign=false','commit','-m','base');
 await fs.writeFile(file('dir','a'),'staged\n');await run('add','.');await fs.writeFile(file('dir','a'),'work\n');
 return {root,repo,file,run,prepare:()=>prepareCommitPreview(repo,inputs()),apply:(snapshot,extra={})=>applyCommitPreview(repo,{snapshot,assertAuthorized(){},onStart(){},...extra}),consume:snapshot=>consumeCommitPreview(repo,{snapshot,assertAuthorized(){}})};
}
const unknown=e=>{assert.equal(e.code,'vcs/commit-outcome-unknown');assert.equal(e.appendOnly,true);assert.equal(e.outcomeUnknown,true);return true;};
const tip=async f=>(await f.run('rev-parse','HEAD')).toString().trim();
async function objects(f){const rows=[];for(const name of await fs.readdir(f.file('.git','objects')))if(/^[a-f0-9]{2}$/.test(name))for(const leaf of await fs.readdir(f.file('.git','objects',name)))rows.push(name+'/'+leaf);return rows.sort();}
for(const format of ['sha1','sha256'])test(format+' real commit exact staged tree/parent/body; preserves divergent work and raw Index',async t=>{
 const f=await fixture(t,format),s=await f.prepare(),index=await fs.readFile(f.file('.git','index')),stat=await fs.stat(f.file('.git','index'),{bigint:true}),old=await objects(f);let starts=0;
 opened=[];const result=await f.apply(s,{onStart(){starts++;assert.throws(()=>{s.message='evil';});assert.throws(()=>{s.commit.oid='evil';});}});
 assert.deepEqual(result,{head:s.commit.oid,ref:s.ref,tree:s.tree,indexDigest:s.indexDigest});assert.equal(starts,1);assert.equal(await tip(f),s.commit.oid);
 assert.ok(opened.every(p=>p.startsWith(f.file('.git')+path.sep)),'no working content opened');
 assert.deepEqual(await fs.readFile(f.file('.git','index')),index);const now=await fs.stat(f.file('.git','index'),{bigint:true});for(const key of ['dev','ino','birthtimeNs','size','mtimeNs','ctimeNs','mode'])assert.equal(now[key],stat[key]);
 assert.equal(await fs.readFile(f.file('dir','a'),'utf8'),'work\n');assert.equal((await f.run('show','HEAD:dir/a')).toString(),'staged\n');
 const body=(await f.run('cat-file','commit',result.head)).toString();assert.equal(body,'tree '+s.tree+'\nparent '+s.head+'\nauthor Confirm Test <confirm@example.invalid> 1700000000 +0800\ncommitter Confirm Test <confirm@example.invalid> 1700000000 +0800\n\nOnly staged\n');
 for(const name of ['logs/HEAD','logs/'+s.ref])assert.ok((await fs.readFile(f.file('.git',...name.split('/')),'utf8')).includes(s.head+' '+result.head+' Dsh <dsh@localhost>'));
 const after=await objects(f);for(const name of old)assert.ok(after.includes(name));await assert.rejects(f.apply(s),/single-use/);await assert.rejects(f.consume(s),/single-use/);
});
test('same private capability: clones/replays/cross-consumption/wrong root and invalid options burn',async t=>{
 const f=await fixture(t),g=await fixture(t),s=await f.prepare();
 for(const fake of [{...s},structuredClone(s),new Proxy(s,{})])await assert.rejects(f.apply(fake),/single-use/);
 await f.consume(s);await assert.rejects(f.apply(s),/single-use/);
 const q=await f.prepare();await assert.rejects(applyCommitPreview(g.repo,{snapshot:q,assertAuthorized(){assert.fail();},onStart(){assert.fail();}}),/Same canonical/);await assert.rejects(f.consume(q),/single-use/);
 const z=await f.prepare();await assert.rejects(f.apply(z,{onStart:null}),/callbacks/);await assert.rejects(f.consume(z),/single-use/);
});
for(const phase of [0,1,2])test('stale metadata before apply or authorization '+phase+' rejected before start',async t=>{
 const f=await fixture(t),s=await f.prepare();let auth=0,start=0;
 if(!phase)await fs.appendFile(f.file('.git','config'),'\n# stale\n');
 await assert.rejects(f.apply(s,{async assertAuthorized(){if(++auth===phase)await fs.writeFile(f.file('.git','foreign'),'foreign');},onStart(){start++;}}),/Stale/);
 assert.equal(start,0);assert.equal(await tip(f),s.head);await assert.rejects(f.consume(s),/single-use/);
});
for(const mode of ['cancel','throw','thenable'])test('start '+mode+' gives unknown without ref writes',async t=>{
 const f=await fixture(t),s=await f.prepare(),controller=new AbortController();let starts=0;
 await assert.rejects(f.apply(s,{signal:controller.signal,onStart(){starts++;if(mode==='cancel')controller.abort(Error('stop'));if(mode==='throw')throw Error('start fail');if(mode==='thenable')return Promise.reject(Error('async start'));}}),unknown);
 assert.equal(starts,1);assert.equal(await tip(f),s.head);
});
test('foreign metadata added after append rejected before CAS; appended and prior objects retained',async t=>{
 const f=await fixture(t),s=await f.prepare(),old=await objects(f);let started=false,injected=false,updates=0;
 observe=args=>{if(args.includes('update-ref'))updates++;};
 await assert.rejects(f.apply(s,{onStart(){started=true;},async assertAuthorized(){if(started&&!injected&&(await objects(f)).length>old.length){injected=true;await fs.writeFile(f.file('.git','foreign'),'unexpected');}}}),unknown);
 assert.equal(injected,true);assert.equal(updates,0);assert.equal(await tip(f),s.head);const after=await objects(f);assert.ok(after.length>old.length);for(const name of old)assert.ok(after.includes(name));
});
test('preexisting object metadata changes after append are not rebaselined',async t=>{
 const f=await fixture(t),s=await f.prepare(),old=await objects(f);let started=false,changed=false;
 await assert.rejects(f.apply(s,{onStart(){started=true;},async assertAuthorized(){if(started&&!changed&&(await objects(f)).length>old.length){changed=true;const p=f.file('.git','objects',...old[0].split('/'));await fs.chmod(p,0o600);await fs.writeFile(p,await fs.readFile(p));}}}),unknown);
 assert.equal(changed,true);assert.equal(await tip(f),s.head);
});

async function prepublish(f,s){
 const target=f.file('.git','objects',s.commit.oid.slice(0,2),s.commit.oid.slice(2));
 await assert.rejects(f.apply(s,{async assertAuthorized(){try{await fs.stat(target);}catch(e){if(e.code==='ENOENT')return;throw e;}throw Error('stop after commit append');}}),unknown);
 assert.equal(await tip(f),s.head);
}
test('all objects preexist: start exactly once at ref start; cancel prevents CAS',async t=>{
 const f=await fixture(t),s=await f.prepare();await prepublish(f,s);
 const q=await f.prepare(),controller=new AbortController();let starts=0,updates=0;observe=args=>{if(args.includes('update-ref'))updates++;};
 await assert.rejects(f.apply(q,{signal:controller.signal,onStart(){starts++;controller.abort(Error('ref-start canceled'));}}),unknown);
 assert.equal(starts,1);assert.equal(updates,0);assert.equal(await tip(f),s.head);
});
test('all objects preexist: successful CAS still starts once and retains objects',async t=>{
 const f=await fixture(t),s=await f.prepare();await prepublish(f,s);const q=await f.prepare(),before=await objects(f);let starts=0;
 await f.apply(q,{onStart(){starts++;}});assert.equal(starts,1);assert.equal(await tip(f),q.commit.oid);assert.deepEqual(await objects(f),before);
});
test('authorization failure after ref update is unknown and never rolls back tip',async t=>{
 const f=await fixture(t),s=await f.prepare();let updated=false;
 observe=(args,child)=>{if(args.includes('update-ref'))child.once('close',()=>{updated=true;});};
 await assert.rejects(f.apply(s,{assertAuthorized(){if(updated)throw Error('authorization revoked after ref');}}),unknown);
 assert.equal(updated,true);assert.equal(await tip(f),s.commit.oid);
});
test('post-ref raw Index rewrite detected even with identical bytes',async t=>{
 const f=await fixture(t),s=await f.prepare();let updated=false,changed=false;
 observe=(args,child)=>{if(args.includes('update-ref'))child.once('close',()=>{updated=true;});};
 await assert.rejects(f.apply(s,{async assertAuthorized(){if(updated&&!changed){changed=true;const p=f.file('.git','index');await fs.writeFile(p,await fs.readFile(p));}}}),unknown);
 assert.equal(changed,true);assert.equal(await tip(f),s.commit.oid);
});
test('shared enclosing budget bounds a stalled authorization and burns capability',async t=>{
 const f=await fixture(t),s=await f.prepare();await assert.rejects(withOperationBudget({timeoutMs:50},()=>f.apply(s,{assertAuthorized:()=>new Promise(()=>{}),onStart(){assert.fail();}})));
 assert.equal(await tip(f),s.head);await assert.rejects(f.consume(s),/single-use/);
});

test('cancellation before authorization burns without mutation',async t=>{
 const f=await fixture(t),s=await f.prepare(),controller=new AbortController(),before=await objects(f);controller.abort(Error('canceled'));
 await assert.rejects(f.apply(s,{signal:controller.signal,onStart(){assert.fail();}}),/canceled/);assert.deepEqual(await objects(f),before);await assert.rejects(f.consume(s),/single-use/);
});
