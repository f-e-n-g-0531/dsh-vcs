import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs/promises';
import syncfs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {git} from '../local-command.mjs';
import {prepareBranchCreate} from '../branch-create-preview.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
const spawn=cp.spawn,open=fs.open,lstat=fs.lstat;let observe,opened,io;
cp.spawn=(command,args,options)=>{
 const child=spawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-branch-preview-no-global')}});
 if(command==='git')observe?.(args.slice(4).filter(a=>!a.startsWith('--git-dir=')&&!a.startsWith('--work-tree=')),child);return child;
};
fs.open=async(...args)=>{opened?.push(args);return open(...args);};
fs.lstat=async(...args)=>{io?.();return lstat(...args);};syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;fs.open=open;fs.lstat=lstat;syncBuiltinESMExports();});
test.afterEach(()=>{observe=opened=io=undefined;});
async function fixture(t,format='sha1'){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-branch-preview-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const file=(...p)=>path.join(root,...p),run=(...args)=>git(root,args),repo={type:'git',root};
 await run('init','--object-format='+format);await run('config','core.autocrlf','false');
 const tree=(await run('mktree')).toString().trim();
 const ref=(await fs.readFile(file('.git','HEAD'),'utf8')).trim().slice(5);
 await fs.writeFile(file('body'),'tree '+tree+'\nauthor A <a@invalid> 1700000000 +0000\ncommitter C <c@invalid> 1700000000 +0000\n\npreview\n');
 const head=(await run('hash-object','-t','commit','-w','--',file('body'))).toString().trim();
 await fs.writeFile(file('.git',...ref.split('/')),head+'\n');await fs.rm(file('body'));
 return {repo,root,file,run,ref,head,preview:(name='new',options={})=>prepareBranchCreate(repo,{name,...options})};
}
async function state(root){
 const rows=[];async function walk(dir){for(const name of (await fs.readdir(dir)).sort()){
  const file=path.join(dir,name),s=await fs.lstat(file,{bigint:true});
  rows.push([path.relative(root,file),String(s.ino),String(s.size),String(s.mtimeNs),String(s.ctimeNs),s.isFile()?createHash('sha256').update(await fs.readFile(file)).digest('hex'):null]);
  if(s.isDirectory())await walk(file);
 }}await walk(root);return rows;
}
for(const format of ['sha1','sha256'])test(format+' fixed HEAD frozen exact projection, unchanged raw repository',async t=>{
 const f=await fixture(t,format);await fs.writeFile(f.file('work'),'opaque');await fs.writeFile(f.file('.git','index'),'invalid index');
 const before=await state(f.root),commands=[];opened=[];observe=args=>commands.push(args);
 const value=await f.preview('feature/安全-é');
 assert.deepEqual(value,{action:'branch-create',name:'feature/安全-é',ref:'refs/heads/feature/安全-é',target:{oid:f.head},head:f.head,currentRef:f.ref,objectFormat:format});
 assert.ok(Object.isFrozen(value));assert.ok(Object.isFrozen(value.target));assert.equal(Reflect.ownKeys(value).length,7);
 assert.equal(commands.filter(a=>a[0]==='cat-file').length,2);
 assert.ok(commands.every(a=>['config','rev-parse','check-ref-format','cat-file'].includes(a[0])));
 assert.ok(opened.every(([p,flags])=>p.startsWith(f.file('.git')+path.sep)&&p!==f.file('.git','index')&&flags===syncfs.constants.O_RDONLY+(syncfs.constants.O_NOFOLLOW||0)));
 assert.deepEqual(await state(f.root),before);
});
const invalid=['','@','HEAD','head','a>b','a<b','a|b','a"b','a'.repeat(256),'-name','refs/heads/foo','a//b','/a','a/','a..b','a@{b','a.lock','a.LOCK','a/.git/x','.git','a.','a /b','a./b','a b','a\\b','a:b','a?b','a*b','a[b','a~b','a^b','a\n','a\u007f','a\u0085','a\u200b','a\u202e','\ud800','con','AUX.txt','x/Lpt1','nul.foo','a'.repeat(1001),'安'.repeat(334)];
for(const name of invalid)test('invalid short name '+JSON.stringify(name)+' rejected before IO',async()=>{
 let calls=0;io=()=>calls++;observe=()=>calls++;
 await assert.rejects(prepareBranchCreate({type:'git',root:path.resolve('missing')},{name}));assert.equal(calls,0);
});
test('strict own-data inputs, getters/extras rejected before IO',async()=>{
 let calls=0,getters=0;io=()=>calls++;observe=()=>calls++;const repo={type:'git',root:path.resolve('missing')};
 for(const r of [null,[],Object.create(repo),{...repo,extra:1},{...repo,[Symbol()]:1},{type:'svn',root:repo.root},{type:'git',root:'.'},{type:'git',get root(){getters++;}}])await assert.rejects(prepareBranchCreate(r,{name:'new'}));
 for(const o of [null,[],{},Object.create({name:'new'}),{name:'new',oid:'a'.repeat(40)},{name:'new',signal:{}},{get name(){getters++;}},{name:'new',get signal(){getters++;}}])await assert.rejects(prepareBranchCreate(repo,o));
 assert.equal(calls,0);assert.equal(getters,0);
});
test('safe existing prefixes and 1000-byte nested short name',async t=>{
 const f=await fixture(t);await fs.mkdir(f.file('.git','refs','heads','feature'));await fs.mkdir(f.file('.git','logs','refs','heads','feature'),{recursive:true});
 assert.equal((await f.preview('feature/new')).name,'feature/new');
 const name=['a'.repeat(249),'b'.repeat(249),'c'.repeat(249),'d'.repeat(250)].join('/');
 assert.equal(Buffer.byteLength(name),1000);assert.equal((await f.preview(name)).name,name);
});
test('snapshots caller inputs synchronously',async t=>{
 const f=await fixture(t),r={...f.repo},o={name:'new'};const pending=prepareBranchCreate(r,o);r.root='bad';o.name='bad..name';assert.equal((await pending).name,'new');
});
for(const target of ['refs/heads/new','refs/heads/new/child','refs/heads/parent','logs/refs/heads/new','logs/refs/heads/parent'])test('target/prefix/reflog collision '+target,async t=>{
 const f=await fixture(t),p=f.file('.git',...target.split('/'));await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,f.head+'\n');
 await assert.rejects(f.preview(target.endsWith('/parent')?'parent/child':'new'),/collision/);
});
test('existing empty target directory refused',async t=>{const f=await fixture(t);await fs.mkdir(f.file('.git','refs','heads','new'));await assert.rejects(f.preview(),/collision/);});
test('case alias refused portably',async t=>{const f=await fixture(t);await fs.writeFile(f.file('.git','refs','heads','NEW'),f.head+'\n');await assert.rejects(f.preview(),/collision/);});
for(const target of ['packed-refs','reftable'])test(target+' rejected wholesale before Git',async t=>{
 const f=await fixture(t);await fs.writeFile(f.file('.git',target),'unrelated');let calls=0;observe=()=>calls++;await assert.rejects(f.preview(),/Unsupported/);assert.equal(calls,0);
});
test('symbolic branch and linked namespace refused',async t=>{
 const f=await fixture(t);await fs.writeFile(f.file('.git','refs','heads','new'),'ref: '+f.ref+'\n');await assert.rejects(f.preview(),/collision/);
 await fs.rm(f.file('.git','refs','heads','new'));await fs.mkdir(f.file('outside'));await fs.symlink(f.file('outside'),f.file('.git','refs','heads','link'),'junction');await assert.rejects(f.preview('link/new'),/Linked/);
});
for(const kind of ['unborn','detached','hooks','config'])test(kind+' unsupported metadata refused',async t=>{
 const f=await fixture(t);
 if(kind==='unborn')await fs.rm(f.file('.git',...f.ref.split('/')));
 if(kind==='detached')await fs.writeFile(f.file('.git','HEAD'),f.head+'\n');
 if(kind==='hooks')await fs.writeFile(f.file('.git','hooks','pre-commit'),'do not run');
 if(kind==='config')await f.run('config','include.path','outside');
 await assert.rejects(f.preview());
});
for(const kind of ['HEAD','config','namespace','target','log'])test('change between latest reads: '+kind,async t=>{
 const f=await fixture(t);let checks=0;
 observe=(args,child)=>{if(args[0]==='check-ref-format'&&++checks===2)child.once('close',()=>{
  if(kind==='HEAD')syncfs.appendFileSync(f.file('.git','HEAD'),'\n');
  if(kind==='config')syncfs.appendFileSync(f.file('.git','config'),'\n# changed between calls\n');
  if(kind==='namespace')syncfs.mkdirSync(f.file('.git','refs','heads','other'));
  if(kind==='target')syncfs.writeFileSync(f.file('.git','refs','heads','new'),f.head+'\n');
  if(kind==='log'){syncfs.mkdirSync(f.file('.git','logs','refs','heads'),{recursive:true});syncfs.writeFileSync(f.file('.git','logs','refs','heads','new'),'log');}
 });};await assert.rejects(f.preview(),/Stale|symbolic|collision/);
});
test('target inserted at final second-read barrier refused',async t=>{
 const f=await fixture(t);let checks=0;observe=(args,child)=>{if(args[0]==='check-ref-format'&&++checks===4)child.once('close',()=>syncfs.writeFileSync(f.file('.git','refs','heads','new'),f.head+'\n'));};await assert.rejects(f.preview(),/Stale|collision/);
});
test('preaborted native signal has no IO',async()=>{
 let calls=0;io=()=>calls++;const c=new AbortController();c.abort();await assert.rejects(prepareBranchCreate({type:'git',root:path.resolve('missing')},{name:'new',signal:c.signal}));assert.equal(calls,0);
});
test('in-flight cancellation and inherited deadline',async t=>{
 const f=await fixture(t),c=new AbortController();observe=(args,child)=>{if(args[0]==='cat-file')child.once('close',()=>c.abort());};await assert.rejects(f.preview('new',{signal:c.signal}));observe=undefined;
 await assert.rejects(withOperationBudget({timeoutMs:1},()=>f.preview()),e=>e.code==='TIMEOUT');
});
