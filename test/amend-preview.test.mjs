import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {git} from '../local-command.mjs';
import * as api from '../commit-preview.mjs';
import {createAmendPlan} from '../src/amend-plan.mjs';
import {readVerifiedCommitMetadata} from '../src/verified-commit-metadata.mjs';
const person={name:'New Committer',email:'new@example.invalid',timestamp:1700000000,timezone:'+0800'};
const options=()=>({committer:{...person},message:'Amended message\n'});
const spawn=cp.spawn,open=fs.open;let observe,observeOpen;
cp.spawn=(command,args,opts)=>{const child=spawn(command,args,{...opts,env:{...opts?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-amend-no-global')}});if(command==='git')observe?.(args.slice(4).filter(arg=>!arg.startsWith('--git-dir=')&&!arg.startsWith('--work-tree=')),child);return child;};
fs.open=async(...args)=>{observeOpen?.(args[0]);return open(...args);};syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;fs.open=open;syncBuiltinESMExports();});test.afterEach(()=>{observe=observeOpen=undefined;});
async function fixture(t,format='sha1',staged=true){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-amend-preview-')));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const file=(...parts)=>path.join(root,...parts),run=(...args)=>git(root,args),repo={type:'git',root};
 await run('init','--object-format='+format);await run('config','user.name','Original Author');await run('config','user.email','old@example.invalid');await run('config','core.autocrlf','false');
 await fs.mkdir(file('nested'));await fs.writeFile(file('nested','a'),'original\n');await run('add','.');await run('-c','commit.gpgsign=false','commit','-m','original');
 if(staged){await fs.writeFile(file('nested','a'),'staged\n');await run('add','.');}
 await fs.writeFile(file('nested','a'),'different working content\n');
 return {root,file,run,repo,prepare:o=>api.prepareAmendPreview(repo,o??options())};
}
async function snapshot(root){
 const rows=[];async function visit(dir){for(const name of (await fs.readdir(dir)).sort()){
 const file=path.join(dir,name),s=await fs.lstat(file,{bigint:true});rows.push([path.relative(root,file),String(s.ino),s.isDirectory()?'directory':[String(s.size),String(s.mtimeNs),String(s.ctimeNs),createHash('sha256').update(await fs.readFile(file)).digest('hex')]]);if(s.isDirectory())await visit(file);
 }}await visit(root);return rows;
}
async function old(f,format){const head=(await f.run('rev-parse','HEAD')).toString().trim(),body=await f.run('cat-file','commit',head);return {head,body,metadata:readVerifiedCommitMetadata(body,{oid:head,objectFormat:format})};}
for(const format of ['sha1','sha256'])for(const staged of [true,false])test(format+' '+(staged?'staged not work':'same-tree message-only')+' amend: pure body oracle, immutable summary, whole repository read-only',async t=>{
 const f=await fixture(t,format,staged),previous=await old(f,format),raw=await fs.readFile(f.file('.git','index'));
 const plan=createAmendPlan(raw,previous.body,{head:previous.head,objectFormat:format,...options()}),before=await snapshot(f.root),opened=[],commands=[];
 observeOpen=file=>opened.push(file);observe=args=>commands.push(args);
 const s=await f.prepare();observe=observeOpen=undefined;
 assert.deepEqual(Object.keys(s),['action','head','ref','objectFormat','indexDigest','previousTree','parents','author','committer','message','tree','commit']);
 assert.equal(s.action,'amend');assert.equal(s.head,previous.head);assert.equal(s.objectFormat,format);assert.equal(s.previousTree,previous.metadata.tree);assert.equal(s.tree,plan.tree);assert.equal(s.commit.oid,plan.commit.oid);
 assert.equal(s.commit.oid,createHash(format).update('commit '+plan.commit.body.length+'\0').update(plan.commit.body).digest('hex'));
 assert.equal(s.tree===s.previousTree,!staged);assert.deepEqual(s.author,previous.metadata.author);assert.deepEqual(s.parents,previous.metadata.parents);assert.notEqual(s.author.name,person.name);assert.deepEqual(s.committer,person);
 for(const value of [s,s.parents,s.author,s.committer,s.commit])assert.ok(Object.isFrozen(value));
 function safe(value){assert.ok(!Buffer.isBuffer(value));if(value&&typeof value==='object')for(const item of Object.values(value))safe(item);}safe(s);
 assert.deepEqual(Object.keys(s.commit),['oid']);assert.ok(opened.every(file=>file.startsWith(f.file('.git')+path.sep)));
 assert.ok(commands.filter(a=>a[0]==='cat-file'&&a[1]==='commit').every(a=>a[2]===previous.head));assert.ok(commands.some(a=>a[0]==='check-attr'&&a.includes('--cached')));
 assert.deepEqual(await snapshot(f.root),before);
 for(const snapshot of [s,{...s},structuredClone(s)])for(const method of [api.consumeCommitPreview,api.applyCommitPreview]){
  const input={snapshot,assertAuthorized(){throw Error('must not run');}};if(method===api.applyCommitPreview)input.onStart=()=>{throw Error('must not run');};
  await assert.rejects(method(f.repo,input),/server-issued/);
 }
 assert.deepEqual(await snapshot(f.root),before);assert.deepEqual(await f.prepare(),s);
});
for(const count of [0,2])test('born symbolic HEAD supports '+count+' original parents without writes',async t=>{
 const f=await fixture(t),previous=await old(f,'sha1');
 const parents=count?[previous.head,await install(f,Buffer.from(previous.body.toString().replace('original\n','other\n')))]:[];
 const body=Buffer.from(['tree '+previous.metadata.tree,...parents.map(p=>'parent '+p),'author Original <a@x> 1 +0530','committer Old <o@x> 2 +0000','','old'].join('\n'));
 const head=await install(f,body);await point(f,head);const before=await snapshot(f.root),s=await f.prepare();assert.deepEqual(s.parents,parents);assert.equal(s.author.name,'Original');assert.deepEqual(await snapshot(f.root),before);
});
async function install(f,body){const frame=Buffer.concat([Buffer.from('commit '+body.length+'\0'),body]),oid=createHash('sha1').update(frame).digest('hex');await fs.mkdir(f.file('.git','objects',oid.slice(0,2)),{recursive:true});await fs.writeFile(f.file('.git','objects',oid.slice(0,2),oid.slice(2)),deflateSync(frame));return oid;}
async function point(f,oid){const ref=(await fs.readFile(f.file('.git','HEAD'),'utf8')).trim().slice(5);await fs.writeFile(f.file('.git',...ref.split('/')),oid+'\n');}
test('exact OID no-op rejected by model; signed HEAD refused',async t=>{
 const f=await fixture(t,'sha1',false),p=await old(f,'sha1');await assert.rejects(f.prepare({committer:p.metadata.committer,message:p.metadata.message}),/no-op/);
 const body=Buffer.from(p.body.toString().replace('\n\n','\ngpgsig fake\n continuation\n\n'));await point(f,await install(f,body));await assert.rejects(f.prepare(),/header|signed|Unsupported/);
});
test('strict own metadata and plaintext validated before I/O; inputs cloned pre-await',async t=>{
 const f=await fixture(t);let calls=0;observe=()=>calls++;let getters=0;
 const bad=options();Object.defineProperty(bad,'committer',{get(){getters++;throw Error('getter');}});await assert.rejects(f.prepare(bad),/own data/);
 const nested=options();Object.defineProperty(nested.committer,'name',{get(){getters++;throw Error('getter');}});await assert.rejects(f.prepare(nested),/own data/);
 for(const o of [{...options(),author:person},{...options(),message:Buffer.from('x')},{...options(),message:'x'.repeat(65537)},{...options(),message:''},{...options(),committer:{...person,extra:true}},Object.create(options())])await assert.rejects(f.prepare(o));
 await assert.rejects(api.prepareCommitPreview(f.repo,options()),/author/);assert.equal(calls,0);assert.equal(getters,0);observe=undefined;
 const o=options(),promise=f.prepare(o);o.committer.name='changed';o.message='changed';const s=await promise;assert.deepEqual(s.committer,person);assert.equal(s.message,'Amended message\n');
});
test('pre-abort and cancellation during fixed read leave repository unchanged',async t=>{
 const f=await fixture(t),before=await snapshot(f.root),pre=new AbortController();pre.abort();await assert.rejects(f.prepare({...options(),signal:pre.signal}));
 const controller=new AbortController();observe=args=>{if(args[0]==='cat-file')controller.abort();};await assert.rejects(f.prepare({...options(),signal:controller.signal}));observe=undefined;assert.deepEqual(await snapshot(f.root),before);
});
for(const target of ['HEAD','index','config'])test('second capture rejects stale '+target,async t=>{
 const f=await fixture(t);let captures=0,mutation;
 observe=(args,child)=>{if(args[0]==='config'&&++captures===2){const emit=child.emit;child.emit=function(event,...rest){if(event==='close'&&!mutation){mutation=(async()=>{await fs.appendFile(f.file('.git',target),target==='index'?Buffer.from([0]):'\n');emit.call(this,event,...rest);})();return true;}return emit.call(this,event,...rest);};}};
 await assert.rejects(f.prepare(),/Stale|index|Index|symbolic/);await mutation;assert.equal(captures,2);
});
for(const [key,value] of [['commit.gpgsign','true'],['filter.bad.clean','bad'],['include.path','../work'],['core.attributesFile','missing']])test('config guard precedes fixed reads: '+key,async t=>{
 const f=await fixture(t);await f.run('config',key,value);const commands=[];observe=args=>commands.push(args);await assert.rejects(f.prepare(),/configuration/);assert.ok(!commands.some(a=>a[0]==='cat-file'));
});
for(const target of ['.gitattributes','.git/index.lock','.git/info/attributes'])test('same fixed-read policy rejects '+target,async t=>{
 const f=await fixture(t);await fs.writeFile(f.file(...target.split('/')),'bad');const commands=[];observe=args=>commands.push(args);await assert.rejects(f.prepare(),/Attributes|metadata/);assert.ok(!commands.some(a=>a[0]==='cat-file'));
});
test('missing fixed Index blob rejected without work fallback',async t=>{
 const f=await fixture(t),{parseGitIndex}=await import('../src/git-index.mjs'),parsed=parseGitIndex(await fs.readFile(f.file('.git','index'))),oid=parsed.entries[0].oid;
 const object=f.file('.git','objects',oid.slice(0,2),oid.slice(2));await fs.unlink(object);const before=await snapshot(f.root);await assert.rejects(f.prepare());assert.deepEqual(await snapshot(f.root),before);
});
test('fixed amend apply only, no generic consume execution escape',()=>{assert.equal(typeof api.applyAmendPreview,'function');assert.equal(api.consumeAmendPreview,undefined);});
