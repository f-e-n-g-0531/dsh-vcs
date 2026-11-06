import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {git} from '../local-command.mjs';
import {prepareCommitPreview} from '../commit-preview.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
const person={name:'Preview Test',email:'preview@example.invalid',timestamp:1700000000,timezone:'+0800'};
const options=()=>({author:{...person},committer:{...person},message:'Preview message\n'});
const spawn=cp.spawn,originalOpen=fs.open;let observe,observeOpen;
fs.open=async(...args)=>{observeOpen?.(args[0]);return originalOpen(...args);};
cp.spawn=(command,args,opts)=>{
 const child=spawn(command,args,{...opts,env:{...opts?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-preview-no-global')}});
 if(command==='git')observe?.(args.slice(4).filter(arg=>!arg.startsWith('--git-dir=')&&!arg.startsWith('--work-tree=')),child);return child;
};syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;fs.open=originalOpen;syncBuiltinESMExports();});test.afterEach(()=>{observe=observeOpen=undefined;});
async function fixture(t,format='sha1'){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-commit-preview-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const run=(...args)=>git(root,args),file=(...parts)=>path.join(root,...parts);
 await run('init','--object-format='+format);await run('config','user.name','Preview');await run('config','user.email','p@example.invalid');await run('config','core.autocrlf','false');
 await fs.mkdir(file('nested'));await fs.writeFile(file('nested','a'),'base\n');await run('add','.');await run('-c','commit.gpgsign=false','commit','-m','base');
 await fs.writeFile(file('nested','a'),'staged\n');await fs.writeFile(file('nested','new'),'addition\n');await run('add','.');
 await fs.writeFile(file('nested','a'),'different work\n');await fs.writeFile(file('untracked'),'untracked\n');
 return {root,file,run,prepare:o=>prepareCommitPreview({type:'git',root},o??options())};
}
async function snapshot(root){
 const rows=[];async function visit(dir){for(const name of (await fs.readdir(dir)).sort()){
 const file=path.join(dir,name),s=await fs.lstat(file,{bigint:true});if(s.isDirectory())await visit(file);else rows.push([path.relative(root,file),String(s.ino),String(s.size),String(s.mtimeNs),String(s.ctimeNs),createHash('sha256').update(await fs.readFile(file)).digest('hex')]);
 }}await visit(root);return rows;
}
for(const format of ['sha1','sha256'])test('actual '+format+' nested staged tree, not work; immutable safe summary and no writes',async t=>{
 const f=await fixture(t,format);
 // Obtain Git golden tree before measuring readonly state: write-tree itself writes objects/index.
 const tree=(await f.run('write-tree')).toString().trim(),before=await snapshot(f.root);
 const opened=[];observeOpen=file=>opened.push(file);
 const result=await f.prepare();assert.ok(opened.every(file=>file.startsWith(f.file('.git')+path.sep)),'no working content opened');assert.equal(result.tree,tree);assert.equal(result.objectFormat,format);
 assert.deepEqual(Object.keys(result),['head','ref','objectFormat','indexDigest','tree','commit','author','committer','message']);
 assert.deepEqual(Object.keys(result.commit),['oid']);assert.equal(result.commit.oid.length,format==='sha1'?40:64);
 for(const value of [result,result.commit,result.author,result.committer])assert.ok(Object.isFrozen(value));
 assert.deepEqual(await snapshot(f.root),before);assert.equal(result.indexDigest,createHash('sha256').update(await fs.readFile(f.file('.git','index'))).digest('hex'));
 const again=await f.prepare();assert.deepEqual(again,result);
});
test('own-data inputs validated before I/O; metadata snapshot before awaits',async t=>{
 const f=await fixture(t);let calls=0;const bad={...options()};Object.defineProperty(bad,'author',{get(){calls++;throw Error('getter');}});
 await assert.rejects(f.prepare(bad),/own data/);assert.equal(calls,0);
 for(const o of [{...options(),extra:true},{...options(),message:'x'.repeat(65537)},{...options(),message:'\u001b[31m'},{...options(),author:{...person,name:'a\n'}}])await assert.rejects(f.prepare(o));
 const o=options(),p=f.prepare(o);o.author.name='Changed';o.committer.timestamp=1;o.message='changed';const result=await p;
 assert.deepEqual(result.author,person);assert.equal(result.message,'Preview message\n');
});
for(const [key,value] of [['filter.bad.clean','echo bad'],['core.hooksPath','missing'],['commit.gpgsign','true'],['gpg.program','bad'],['core.worktree','..'],['core.sharedRepository','true'],['core.attributesFile','missing'],['extensions.worktreeConfig','true'],['core.fsmonitor','bad']])test('reject config before fixed reads: '+key,async t=>{
 const f=await fixture(t);await f.run('config',key,value);const commands=[];observe=args=>commands.push(args[0]);
 await assert.rejects(f.prepare(),/configuration|conversions/);assert.ok(!commands.includes('cat-file'));
});
test('config includes are refused without expanding working-file contents',async t=>{const f=await fixture(t);await fs.writeFile(f.file('work-config'),'invalid config content');await f.run('config','include.path','../work-config');const commands=[];observe=args=>commands.push(args);await assert.rejects(f.prepare(),/Unsupported repository configuration: include.path/);assert.ok(commands.find(args=>args[0]==='config'&&args.includes('--no-includes')));assert.ok(!commands.some(args=>args[0]==='cat-file'));});

for(const target of ['index','HEAD','config'])test('reject hardlinked '+target+' before fixed reads',async t=>{
 const f=await fixture(t);await fs.link(f.file('.git',target),f.file('hardlink'));const commands=[];observe=args=>commands.push(args[0]);await assert.rejects(f.prepare(),/Linked|single-link/);assert.ok(!commands.includes('cat-file'));
});
for(const target of ['index.lock','MERGE_HEAD','shallow','objects/info/alternates','hooks/pre-commit','info/attributes'])test('reject unsupported metadata '+target+' before object read',async t=>{
 const f=await fixture(t);await fs.writeFile(f.file('.git',...target.split('/')),'unsafe');const commands=[];observe=args=>commands.push(args[0]);await assert.rejects(f.prepare(),/metadata/);assert.ok(!commands.includes('cat-file'));
});
test('reject working attributes without reading their contents',async t=>{
 const f=await fixture(t);await fs.writeFile(f.file('nested','.gitattributes'),'x filter=bad');const commands=[];observe=args=>commands.push(args[0]);await assert.rejects(f.prepare(),/Attributes/);assert.ok(!commands.includes('cat-file'));
});
for(const target of ['HEAD','index'])test('second capture stale barrier rejects mutation of '+target,async t=>{
 const f=await fixture(t);let captures=0,mutation;
 observe=(args,child)=>{if(args[0]==='config'&&++captures===2){
  const emit=child.emit;child.emit=function(event,...rest){if(event==='close'&&!mutation){mutation=(async()=>{
   if(target==='HEAD'){const head=(await f.run('rev-parse','HEAD')).toString();await fs.writeFile(f.file('.git','HEAD'),head);}else await fs.writeFile(f.file('.git','index'),Buffer.alloc(12));
   emit.call(this,event,...rest);
  })();return true;}return emit.call(this,event,...rest);};
 }};
 await assert.rejects(f.prepare(),/symbolic|index|Index|Stale/);assert.equal(captures,2);await mutation;
});
for(const [target,max] of [['index',8*1024*1024],['config',256*1024]])test('bounded '+target+' input',async t=>{
 const f=await fixture(t);await fs.writeFile(f.file('.git',target),Buffer.alloc(max+1));await assert.rejects(f.prepare(),/bounded/);
});
test('signed parent refused and oversized parent bounded',async t=>{
 const f=await fixture(t),tree=(await f.run('rev-parse','HEAD^{tree}')).toString().trim();
 async function parent(extra,message){
 const body=Buffer.from('tree '+tree+'\nauthor P <p@x> 1 +0000\ncommitter P <p@x> 1 +0000\n'+extra+'\n'+message);
 const oid=createHash('sha1').update('commit '+body.length+'\0').update(body).digest('hex');
 const {deflateSync}=await import('node:zlib');await fs.mkdir(f.file('.git','objects',oid.slice(0,2)),{recursive:true});await fs.writeFile(f.file('.git','objects',oid.slice(0,2),oid.slice(2)),deflateSync(Buffer.concat([Buffer.from('commit '+body.length+'\0'),body])));
 const ref=(await fs.readFile(f.file('.git','HEAD'),'utf8')).trim().slice(5);await fs.writeFile(f.file('.git',...ref.split('/')),oid+'\n');
 }
 await parent('gpgsig fake\n continuation\n','message');await assert.rejects(f.prepare(),/header|signed|Unsupported/);
 await parent('','x'.repeat(2*1024*1024));await assert.rejects(f.prepare(),e=>e.code==='TOO_LARGE');
});
for(const target of ['root','.git','HEAD','index'])test('reject linked '+target,async t=>{
 const f=await fixture(t);
 if(target==='root'){
  const alias=f.root+'-alias';await fs.symlink(f.root,alias,process.platform==='win32'?'junction':'dir');t.after(()=>fs.unlink(alias));
  await assert.rejects(prepareCommitPreview({type:'git',root:alias},options()),/Canonical/);
 }else{
  const source=target==='.git'?f.file('.git'):f.file('.git',target),backup=source+'-original';
  await fs.rename(source,backup);await fs.symlink(backup,source,target==='.git'?(process.platform==='win32'?'junction':'dir'):'file');
  await assert.rejects(f.prepare(),/Linked/);
 }
});
test('late second capture HEAD mutation rejected by closing metadata barrier',async t=>{
 const f=await fixture(t);let refs=0,mutation;
 observe=(args,child)=>{if(args[0]==='check-ref-format'&&++refs===2){const emit=child.emit;
  child.emit=function(event,...rest){if(event==='close'&&!mutation){mutation=fs.writeFile(f.file('.git','HEAD'),'ref: refs/heads/other\n').then(()=>emit.call(this,event,...rest));return true;}return emit.call(this,event,...rest);};
 }};
 await assert.rejects(f.prepare(),/Stale/);await mutation;
});
for(const kind of ['cancel','deadline'])test(kind+' propagates and child drains',async t=>{
 const f=await fixture(t),controller=new AbortController();let active=0;
 observe=(args,child)=>{active++;child.once('close',()=>active--);if(kind==='cancel')controller.abort();};
 if(kind==='cancel')await assert.rejects(f.prepare({...options(),signal:controller.signal}));
 else await assert.rejects(withOperationBudget({timeoutMs:1},()=>f.prepare()),e=>e.code==='TIMEOUT');
 assert.equal(active,0);
});
