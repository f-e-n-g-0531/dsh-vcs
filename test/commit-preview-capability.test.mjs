import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {git} from '../local-command.mjs';
import * as preview from '../commit-preview.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
const {prepareCommitPreview,consumeCommitPreview}=preview;
const person={name:'Capability Test',email:'cap@example.invalid',timestamp:1700000000,timezone:'+0800'};
const metadata=()=>({author:{...person},committer:{...person},message:'Private plan\n'});
const spawn=cp.spawn,open=fs.open;let observe,opened;
cp.spawn=(command,args,options)=>{const child=spawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-preview-no-global')}});if(command==='git')observe?.(args.slice(4).filter(arg=>!arg.startsWith('--git-dir=')&&!arg.startsWith('--work-tree=')),child);return child;};
fs.open=async(...args)=>{opened?.push(args[0]);return open(...args);};syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;fs.open=open;syncBuiltinESMExports();});
test.afterEach(()=>{observe=opened=undefined;});
async function fixture(t,format='sha1'){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-preview-cap-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const repo={type:'git',root},file=(...p)=>path.join(root,...p),run=(...args)=>git(root,args);
 await run('init','--object-format='+format);await run('config','user.name','Cap');await run('config','user.email','cap@x');await run('config','core.autocrlf','false');
 await fs.mkdir(file('dir'));await fs.writeFile(file('dir','a'),'base\n');await run('add','.');await run('-c','commit.gpgsign=false','commit','-m','base');
 await fs.writeFile(file('dir','a'),'staged\n');await run('add','.');await fs.writeFile(file('dir','a'),'work\n');
 return {root,repo,file,run,prepare:()=>prepareCommitPreview(repo,metadata()),consume:(snapshot,extra={})=>consumeCommitPreview(repo,{snapshot,assertAuthorized(){},...extra})};
}
async function state(root){
 const rows=[];async function walk(dir){for(const name of (await fs.readdir(dir)).sort()){
  const file=path.join(dir,name),s=await fs.lstat(file,{bigint:true});if(s.isDirectory())await walk(file);else rows.push([path.relative(root,file),String(s.ino),String(s.size),String(s.mtimeNs),String(s.ctimeNs),createHash('sha256').update(await fs.readFile(file)).digest('hex')]);
 }}await walk(root);return rows;
}
function safe(value){
 assert.deepEqual(Reflect.ownKeys(value),['head','ref','objectFormat','indexDigest','tree','commit','author','committer','message']);
 assert.deepEqual(Reflect.ownKeys(value.commit),['oid']);
 function visit(v){assert.ok(!Buffer.isBuffer(v));if(v&&typeof v==='object'){assert.ok(Object.isFrozen(v));for(const k of Reflect.ownKeys(v)){assert.ok(!['plan','body','trees','id','token','consumed','authorized'].includes(k));visit(v[k]);}}}visit(value);
}
async function burned(f,s){await assert.rejects(f.consume(s),/single-use server-issued/);}
for(const format of ['sha1','sha256'])test(format+' exact issued summary single use; frozen safe output and no writes',async t=>{
 const f=await fixture(t,format),before=await state(f.root),s=await f.prepare();safe(s);assert.equal(s.commit.oid.length,format==='sha1'?40:64);
 const commands=[];opened=[];observe=args=>commands.push(args);let auth=0;
 const result=await f.consume(s,{assertAuthorized(){auth++;}});safe(result);assert.deepEqual(result,s);assert.notEqual(result,s);assert.equal(auth,2);
 assert.ok(opened.every(p=>p.startsWith(f.file('.git')+path.sep)),'working content never opened');
 assert.ok(commands.some(a=>a[0]==='check-attr'&&a.includes('--cached')));assert.ok(commands.some(a=>a[0]==='cat-file'&&a[1]==='commit'));assert.ok(commands.some(a=>a[0]==='cat-file'&&a[1]==='-t'));
 assert.ok(commands.every(a=>['config','rev-parse','check-ref-format','check-attr','cat-file'].includes(a[0])));
 await burned(f,s);await burned(f,result);assert.deepEqual(await state(f.root),before);
});
test('cloned, forged, proxy and cross-repository summaries cannot grant access',async t=>{
 const f=await fixture(t),g=await fixture(t),s=await f.prepare();let calls=0;observe=()=>calls++;
 for(const fake of [{...s},structuredClone(s),Object.freeze({...s,authorized:true}),new Proxy(s,{})])await assert.rejects(f.consume(fake),/single-use server-issued/);
 assert.equal(calls,0);await f.consume(s);
 const q=await f.prepare();await assert.rejects(consumeCommitPreview(g.repo,{snapshot:q,assertAuthorized(){assert.fail('wrong repo callback');}}),/Same canonical/);await burned(f,q);
});
for(const kind of ['callback','extra','accessor','inherited','repository','repoGetter','optionsPrototype'])test('burn before invalid '+kind+' metadata or callback, no I/O or getters',async t=>{
 const f=await fixture(t),s=await f.prepare();let calls=0,getters=0;observe=()=>calls++;
 let repo=f.repo,o={snapshot:s,assertAuthorized(){assert.fail('invalid callback reached');}};
 if(kind==='callback')o.assertAuthorized=null;
 if(kind==='extra')o.execute=true;
 if(kind==='accessor')Object.defineProperty(o,'assertAuthorized',{get(){getters++;throw Error('getter');}});
 if(kind==='inherited'){delete o.assertAuthorized;Object.setPrototypeOf(o,{assertAuthorized(){getters++;}});}
 if(kind==='repository')repo={type:'svn',root:f.root};
 if(kind==='repoGetter'){repo={type:'git'};Object.defineProperty(repo,'root',{get(){getters++;throw Error('getter');}});}
 if(kind==='optionsPrototype')Object.setPrototypeOf(o,[]);
 await assert.rejects(consumeCommitPreview(repo,o));assert.equal(calls,0);assert.equal(getters,0);await burned(f,s);
});
test('accessor snapshot is never invoked and is not an identity capability',async t=>{
 const f=await fixture(t),s=await f.prepare();let getters=0;
 await assert.rejects(consumeCommitPreview(f.repo,{get snapshot(){getters++;return s;},assertAuthorized(){}}),/own data/);assert.equal(getters,0);
 await f.consume(s);
});
test('synchronous burn precedes repository inspection and concurrent/reentrant calls',async t=>{
 const f=await fixture(t),s=await f.prepare();let reentrant;
 const repo=new Proxy(f.repo,{ownKeys(target){reentrant=f.consume(s);return Reflect.ownKeys(target);}});
 const pending=consumeCommitPreview(repo,{snapshot:s,assertAuthorized(){}});await assert.rejects(reentrant,/single-use/);await pending;
 const q=await f.prepare();const a=f.consume(q);await burned(f,q);await a;
});
for(const phase of [1,2])test('authorization revoked at phase '+phase+' burns without writes',async t=>{
 const f=await fixture(t),s=await f.prepare(),before=await state(f.root);let calls=0;
 await assert.rejects(f.consume(s,{assertAuthorized(){if(++calls===phase)throw Error('revoked');}}),/revoked/);assert.equal(calls,phase);await burned(f,s);assert.deepEqual(await state(f.root),before);
});
for(const target of ['HEAD','index','config','metadata'])test('original full fingerprint rejects stale '+target,async t=>{
 const f=await fixture(t),s=await f.prepare();
 if(target==='HEAD')await fs.appendFile(f.file('.git','HEAD'),'\n');
 if(target==='index')await fs.writeFile(f.file('.git','index'),await fs.readFile(f.file('.git','index')));
 if(target==='config')await f.run('config','user.name','Changed but supported');
 if(target==='metadata')await fs.writeFile(f.file('.git','new-metadata'),'changed');
 const before=await state(f.root);await assert.rejects(f.consume(s),/Stale|symbolic/);await burned(f,s);assert.deepEqual(await state(f.root),before);
});
for(const phase of [1,2])for(const target of ['HEAD','index','config','metadata','attributes'])test('callback mutation phase '+phase+' '+target+' rejected after final authorization',async t=>{
 const f=await fixture(t),s=await f.prepare();let calls=0;
 await assert.rejects(f.consume(s,{async assertAuthorized(){if(++calls!==phase)return;
  if(target==='HEAD')await fs.appendFile(f.file('.git','HEAD'),'\n');
  if(target==='index')await fs.writeFile(f.file('.git','index'),await fs.readFile(f.file('.git','index')));
  if(target==='config')await fs.appendFile(f.file('.git','config'),'\n# mutation\n');
  if(target==='metadata')await fs.writeFile(f.file('.git','new-metadata'),'changed');
  if(target==='attributes')await fs.writeFile(f.file('dir','.gitattributes'),'* text');
 }}),/Stale|Attributes|symbolic/);await burned(f,s);
});
test('work file content is intentionally not pinned; policy directory identities remain unchanged',async t=>{
 const f=await fixture(t),s=await f.prepare();await fs.writeFile(f.file('dir','a'),'arbitrary unstaged replacement');
 opened=[];const result=await f.consume(s);assert.deepEqual(result,s);assert.ok(opened.every(p=>p.startsWith(f.file('.git')+path.sep)));
});
for(const kind of ['preabort','callbackAbort','commandAbort','deadline','stalledAuthorization'])test(kind+' burns, cancels and drains without writes',async t=>{
 const f=await fixture(t),s=await f.prepare(),before=await state(f.root),controller=new AbortController();let active=0;
 observe=(args,child)=>{active++;child.once('close',()=>active--);if(kind==='commandAbort')controller.abort();};
 if(kind==='preabort')controller.abort();
 const extra={signal:controller.signal,assertAuthorized(){if(kind==='callbackAbort')controller.abort();if(kind==='stalledAuthorization')return new Promise(()=>{});}};
 const consume=()=>f.consume(s,extra);
 if(['deadline','stalledAuthorization'].includes(kind))await assert.rejects(withOperationBudget({timeoutMs:10},consume),e=>e.code==='TIMEOUT');else await assert.rejects(consume());
 assert.equal(active,0);await burned(f,s);assert.deepEqual(await state(f.root),before);
});
test('canonical root alias rejected and burned before repository reads',async t=>{
 const f=await fixture(t),s=await f.prepare(),alias=f.root+'-alias';
 await fs.symlink(f.root,alias,process.platform==='win32'?'junction':'dir');t.after(()=>fs.unlink(alias));let calls=0;observe=()=>calls++;
 await assert.rejects(consumeCommitPreview({type:'git',root:alias},{snapshot:s,assertAuthorized(){assert.fail('alias callback');}}),/Same canonical/);assert.equal(calls,0);await burned(f,s);
});
test('consume captures repository and callback metadata before awaiting authorization',async t=>{
 const f=await fixture(t),s=await f.prepare(),repo={...f.repo};let release,calls=0;
 const gate=new Promise(r=>{release=r;}),options={snapshot:s,assertAuthorized(){calls++;return gate;}};
 const pending=consumeCommitPreview(repo,options);repo.root='invalid';repo.type='svn';options.assertAuthorized=()=>{throw Error('mutated callback');};release();
 assert.deepEqual(await pending,s);assert.equal(calls,2);
});
test('module exposes only fixed prepare consume and private-snapshot apply entry points',()=>{
 assert.deepEqual(Object.keys(preview).sort(),['applyAmendPreview','applyCommitPreview','consumeCommitPreview','prepareAmendPreview','prepareCommitPreview']);
});
