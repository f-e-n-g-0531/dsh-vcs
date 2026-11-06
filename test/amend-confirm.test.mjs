import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readVerifiedCommitMetadata} from '../src/verified-commit-metadata.mjs';
import {encodeGitCommit} from '../src/git-commit-object.mjs';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {git} from '../local-command.mjs';
import {prepareCommitPreview,consumeCommitPreview,applyCommitPreview,prepareAmendPreview,applyAmendPreview} from '../commit-preview.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
const person={name:'Confirm Test',email:'confirm@example.invalid',timestamp:1700000000,timezone:'+0800'};
const inputs=()=>({committer:{...person},message:'Only staged\n'});
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
 return {root,repo,file,run,prepare:()=>prepareAmendPreview(repo,inputs()),apply:(snapshot,extra={})=>applyAmendPreview(repo,{snapshot,assertAuthorized(){},onStart(){},...extra}),consume:snapshot=>consumeCommitPreview(repo,{snapshot,assertAuthorized(){}})};
}
const unknown=e=>{assert.equal(e.code,'vcs/amend-outcome-unknown');assert.equal(e.appendOnly,true);assert.equal(e.outcomeUnknown,true);return true;};
const tip=async f=>(await f.run('rev-parse','HEAD')).toString().trim();

async function install(f,format,body){
 const raw=Buffer.concat([Buffer.from('commit '+body.length+'\0'),body]),oid=createHash(format).update(raw).digest('hex');
 await fs.mkdir(f.file('.git','objects',oid.slice(0,2)),{recursive:true});await fs.writeFile(f.file('.git','objects',oid.slice(0,2),oid.slice(2)),deflateSync(raw));return oid;
}
async function pin(f,oid){const ref=(await fs.readFile(f.file('.git','HEAD'),'utf8')).trim().slice(5);await f.run('update-ref',ref,oid);}
async function protectedFiles(f){
 const result=[];for(const name of ['.git/index','.git/config','dir/a']){const file=f.file(...name.split('/')),s=await fs.stat(file,{bigint:true});result.push([name,await fs.readFile(file),...['dev','ino','birthtimeNs','size','mtimeNs','ctimeNs','mode'].map(k=>String(s[k]))]);}return result;
}
for(const format of ['sha1','sha256'])for(const count of [0,1,2])for(const staged of [false,true])test(format+' amend '+count+' parents '+(staged?'staged divergent work':'same-tree message-only'),async t=>{
 const f=await fixture(t,format),base=await tip(f),baseBody=await f.run('cat-file','commit',base),previous=readVerifiedCommitMetadata(baseBody,{oid:base,objectFormat:format});
 const sibling=await install(f,format,Buffer.from(baseBody.toString().replace('base\n','sibling\n'))),parents=count===0?[]:count===1?[base]:[sibling,base];
 const author={name:'Original Author',email:'original@x',timestamp:12345,timezone:'-0530'},committer={name:'Old',email:'old@x',timestamp:12346,timezone:'+0000'};
 const old=encodeGitCommit({tree:previous.tree,parents,author,committer,message:'old\n'},{objectFormat:format});await pin(f,await install(f,format,old.body));
 if(!staged){await f.run('read-tree',old.oid);}
 const s=await f.prepare(),before=await protectedFiles(f),logs=new Map();for(const name of ['logs/HEAD','logs/'+s.ref])logs.set(name,await fs.readFile(f.file('.git',...name.split('/'))));
 const commands=[];opened=[];observe=args=>commands.push(args);let starts=0;const result=await f.apply(s,{onStart(){starts++;}});observe=undefined;
 assert.deepEqual(result,{head:s.commit.oid,ref:s.ref,tree:s.tree,indexDigest:s.indexDigest});assert.ok(Object.isFrozen(result));assert.equal(starts,1);
 assert.ok(opened.every(p=>p.startsWith(f.file('.git')+path.sep)));opened=undefined;
 assert.deepEqual(await protectedFiles(f),before);assert.equal(await tip(f),s.commit.oid);assert.equal(s.tree===s.previousTree,!staged);
 const body=await f.run('cat-file','commit',result.head),meta=readVerifiedCommitMetadata(body,{oid:result.head,objectFormat:format});assert.deepEqual(meta.parents,parents);assert.deepEqual(meta.author,author);assert.deepEqual(meta.committer,person);assert.equal(meta.message,'Only staged\n');
 assert.ok(body.equals(encodeGitCommit({tree:s.tree,parents,author,committer:person,message:'Only staged\n'},{objectFormat:format}).body));
 assert.equal((await f.run('show','HEAD:dir/a')).toString(),staged?'staged\n':'base\n');
 const cas=commands.filter(a=>a.includes('update-ref'));assert.equal(cas.length,1);assert.deepEqual(cas[0].slice(-3),[s.ref,s.commit.oid,s.head]);
 assert.ok(commands.filter(a=>a.includes('cat-file')&&a.includes('commit')).every(a=>a.at(-1)===s.head));
 for(const [name,original] of logs){const now=await fs.readFile(f.file('.git',...name.split('/')));assert.ok(now.subarray(0,original.length).equals(original));const tail=now.subarray(original.length).toString();assert.ok(tail.startsWith(s.head+' '+s.commit.oid+' '));assert.equal(tail.split('\n').length,2);}
 await assert.rejects(f.apply(s),/single-use/);
});
test('capabilities are isolated: clones, proxies, cross-map rejection do not burn the other map',async t=>{
 const f=await fixture(t),s=await f.prepare();for(const fake of [{...s},structuredClone(s),new Proxy(s,{})])await assert.rejects(f.apply(fake),/single-use/);
 for(const method of [consumeCommitPreview,applyCommitPreview])await assert.rejects(method(f.repo,{snapshot:s,assertAuthorized(){assert.fail();},...(method===applyCommitPreview?{onStart(){assert.fail();}}:{})}),/single-use/);
 await f.apply(s);
 const g=await fixture(t),normal=await prepareCommitPreview(g.repo,{author:{...person},...inputs()});await assert.rejects(g.apply(normal),/single-use/);await consumeCommitPreview(g.repo,{snapshot:normal,assertAuthorized(){}});
 const normal2=await prepareCommitPreview(g.repo,{author:{...person},...inputs()});await assert.rejects(g.apply(normal2),/single-use/);await applyCommitPreview(g.repo,{snapshot:normal2,assertAuthorized(){},onStart(){}});
});
test('own amend capability burns before wrong root, malformed metadata, callbacks and public mode validation',async t=>{
 const f=await fixture(t),g=await fixture(t);let getters=0;
 for(const invalid of [s=>applyAmendPreview(g.repo,{snapshot:s}),s=>f.apply(s,{onStart:null}),s=>f.apply(s,{mode:'commit'}),s=>applyAmendPreview(null,{snapshot:s}),s=>{const o={snapshot:s,onStart(){}};Object.defineProperty(o,'assertAuthorized',{get(){getters++;}});return applyAmendPreview(f.repo,o);}]){const s=await f.prepare();await assert.rejects(invalid(s));await assert.rejects(f.apply(s),/single-use/);}assert.equal(getters,0);
});
for(const format of ['sha1','sha256'])test(format+' exact no-op is read-only and same-tree committer-only is allowed',async t=>{
 const f=await fixture(t,format);await f.run('read-tree','HEAD');const head=await tip(f),body=await f.run('cat-file','commit',head),meta=readVerifiedCommitMetadata(body,{oid:head,objectFormat:format}),before=await protectedFiles(f),beforeObjects=await objects(f);
 await assert.rejects(prepareAmendPreview(f.repo,{committer:meta.committer,message:meta.message}),/no-op/);assert.deepEqual(await protectedFiles(f),before);assert.deepEqual(await objects(f),beforeObjects);
 const s=await prepareAmendPreview(f.repo,{committer:{...person},message:meta.message});assert.equal(s.tree,s.previousTree);await f.apply(s);assert.equal(await tip(f),s.commit.oid);
});

async function objects(f){const rows=[];for(const name of await fs.readdir(f.file('.git','objects')))if(/^[a-f0-9]{2}$/.test(name))for(const leaf of await fs.readdir(f.file('.git','objects',name)))rows.push(name+'/'+leaf);return rows.sort();}
for(const phase of [0,1,2])test('stale metadata before apply or authorization '+phase+' rejected before start',async t=>{
 const f=await fixture(t),s=await f.prepare();let auth=0,start=0;
 if(!phase)await fs.appendFile(f.file('.git','config'),'\n# stale\n');
 await assert.rejects(f.apply(s,{async assertAuthorized(){if(++auth===phase)await fs.writeFile(f.file('.git','foreign'),'foreign');},onStart(){start++;}}),/Stale/);
 assert.equal(start,0);assert.equal(await tip(f),s.head);await assert.rejects(f.apply(s),/single-use/);
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
test('newly appended compressed object trailing bytes rejected before CAS and retained',async t=>{
 const f=await fixture(t),s=await f.prepare();let started=false,changed=false,updates=0;observe=args=>{if(args.includes('update-ref'))updates++;};
 const target=f.file('.git','objects',s.commit.oid.slice(0,2),s.commit.oid.slice(2));
 await assert.rejects(f.apply(s,{onStart(){started=true;},async assertAuthorized(){if(started&&!changed){try{await fs.stat(target);}catch(e){if(e.code==='ENOENT')return;throw e;}changed=true;await fs.chmod(target,0o600);await fs.appendFile(target,Buffer.from('trailing'));}}}),unknown);
 assert.equal(changed,true);assert.equal(updates,0);assert.equal(await tip(f),s.head);assert.ok((await fs.readFile(target)).subarray(-8).equals(Buffer.from('trailing')));
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
 assert.equal(await tip(f),s.head);await assert.rejects(f.apply(s),/single-use/);
});

test('cancellation before authorization burns without mutation',async t=>{
 const f=await fixture(t),s=await f.prepare(),controller=new AbortController(),before=await objects(f);controller.abort(Error('canceled'));
 await assert.rejects(f.apply(s,{signal:controller.signal,onStart(){assert.fail();}}),/canceled/);assert.deepEqual(await objects(f),before);await assert.rejects(f.apply(s),/single-use/);
});
