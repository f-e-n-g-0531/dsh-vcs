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
import {prepareTagCreate} from '../tag-create-preview.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
const tagger={name:'发布者 é',email:'tag@invalid',timestamp:1700000000,timezone:'+0800'};
const spawn=cp.spawn,open=fs.open,lstat=fs.lstat,readdir=fs.readdir;let observe,opened,io,listing;
cp.spawn=(command,args,options)=>{
 const child=spawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-tag-preview-no-global')}});
 if(command==='git')observe?.(args.slice(4).filter(a=>!a.startsWith('--git-dir=')&&!a.startsWith('--work-tree=')),child);return child;
};
fs.open=async(...args)=>{opened?.push(args);return open(...args);};
fs.lstat=async(...args)=>{io?.();return lstat(...args);};syncBuiltinESMExports();
fs.readdir=async(...args)=>listing?.(...args)??readdir(...args);syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;fs.open=open;fs.lstat=lstat;fs.readdir=readdir;syncBuiltinESMExports();});
test.afterEach(()=>{observe=opened=io=listing=undefined;});
async function fixture(t,format='sha1'){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-tag-preview-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const file=(...p)=>path.join(root,...p),run=(...args)=>git(root,args),repo={type:'git',root};
 await run('init','--object-format='+format);await run('config','core.autocrlf','false');
 const tree=(await run('mktree')).toString().trim();
 const ref=(await fs.readFile(file('.git','HEAD'),'utf8')).trim().slice(5);
 await fs.writeFile(file('body'),'tree '+tree+'\nauthor A <a@invalid> 1700000000 +0000\ncommitter C <c@invalid> 1700000000 +0000\n\npreview\n');
 const head=(await run('hash-object','-t','commit','-w','--',file('body'))).toString().trim();
 await fs.writeFile(file('.git',...ref.split('/')),head+'\n');await fs.rm(file('body'));
 return {repo,root,file,run,ref,head,tree,preview:(name='new',options={})=>prepareTagCreate(repo,{name,tagger:{...tagger},message:'release',...options})};
}
async function state(root){
 const rows=[];async function walk(dir){for(const name of (await fs.readdir(dir)).sort()){
  const file=path.join(dir,name),s=await fs.lstat(file,{bigint:true});
  rows.push([path.relative(root,file),String(s.ino),String(s.size),String(s.mtimeNs),String(s.ctimeNs),s.isFile()?createHash('sha256').update(await fs.readFile(file)).digest('hex'):null]);
  if(s.isDirectory())await walk(file);
 }}await walk(root);return rows;
}

for(const format of ['sha1','sha256'])test(format+' exact frozen summary and raw whole repository unchanged',async t=>{
 const f=await fixture(t,format),name='release/安全-é',message='\uFEFF版本\r\n exact\tmessage\n\n';
 await fs.writeFile(f.file('work'),'opaque');await fs.writeFile(f.file('.git','index'),'invalid index');
 const before=await state(f.root),commands=[];opened=[];observe=args=>commands.push(args);
 const result=await f.preview(name,{message:Buffer.from(message)});
 const {encodeGitTag}=await import('../src/git-tag-object.mjs');
 const expected=encodeGitTag({object:f.head,tag:name,tagger,message},{objectFormat:format});
 assert.deepEqual(result,{action:'tag-create',name,ref:'refs/tags/'+name,objectFormat:format,head:f.head,currentRef:f.ref,targetTree:f.tree,tagger,message,messageBytes:Buffer.byteLength(message),object:{oid:expected.oid},planId:result.planId});
 assert.match(result.planId,/^[a-f0-9]{64}$/);assert.equal(Reflect.ownKeys(result).length,12);
 for(const value of [result,result.tagger,result.object])assert.ok(Object.isFrozen(value));
 assert.equal(commands.filter(a=>a[0]==='cat-file').length,3);
 assert.ok(commands.filter(a=>a[0]==='cat-file').every(a=>a.length===3&&a[1]==='commit'&&a[2]===f.head));
 assert.ok(commands.every(a=>['config','rev-parse','check-ref-format','cat-file'].includes(a[0])));
 assert.ok(opened.every(([p,flags])=>p.startsWith(f.file('.git')+path.sep)&&p!==f.file('.git','index')&&flags===syncfs.constants.O_RDONLY+(syncfs.constants.O_NOFOLLOW||0)));
 assert.deepEqual(await state(f.root),before);
});
test('strict required own-data records, target/ref/OID extras rejected pre-IO without getters',async()=>{
 let calls=0,getters=0;io=()=>calls++;observe=()=>calls++;
 const repo={type:'git',root:path.resolve('missing')},valid={name:'new',tagger,message:'release'};
 for(const r of [null,[],{},Object.create(repo),{...repo,extra:1},{...repo,[Symbol()]:1},{type:'svn',root:repo.root},{type:'git',root:'.'},{type:'git',get root(){getters++;}}])await assert.rejects(prepareTagCreate(r,valid));
 for(const o of [null,[],{},Object.create(valid),{...valid,oid:'1'.repeat(40)},{...valid,target:'HEAD'},{...valid,ref:'refs/tags/x'},{...valid,signal:{}},{...valid,get name(){getters++;}},{...valid,get message(){getters++;}},{...valid,get tagger(){getters++;}},{...valid,tagger:{...tagger,get name(){getters++;}}},{...valid,tagger:{...tagger,extra:1}}])await assert.rejects(prepareTagCreate(repo,o));
 assert.equal(calls,0);assert.equal(getters,0);
});
const invalid=['','HEAD','head','@','refs/tags/x','-name','a//b','a..b','a@{b','a.LOCK','a/.git/x','a.','a b','a\\b','con','nul.foo','a'.repeat(1001),'安'.repeat(334),'\ud800'];
for(const name of invalid)test('invalid name pre-IO '+JSON.stringify(name),async()=>{
 let calls=0;io=()=>calls++;await assert.rejects(prepareTagCreate({type:'git',root:path.resolve('missing')},{name,tagger,message:'release'}));assert.equal(calls,0);
});
for(const message of [undefined,'','  ','\ud800','bad\0',Buffer.from([0xff]),Buffer.alloc(65537), '安'.repeat(22000),'-----BEGIN PGP SIGNATURE-----'])test('invalid message '+String(message).slice(0,30),async()=>{
 let calls=0;io=()=>calls++;await assert.rejects(prepareTagCreate({type:'git',root:path.resolve('missing')},{name:'new',tagger,message}));assert.equal(calls,0);
});
test('caller repository identity and message Buffer copied synchronously',async t=>{
 const f=await fixture(t),r={...f.repo},identity={...tagger},message=Buffer.from('release'),o={name:'new',tagger:identity,message};
 const pending=prepareTagCreate(r,o);r.root='bad';o.name='bad..name';identity.name='bad';message.fill(0);
 const value=await pending;assert.equal(value.name,'new');assert.equal(value.tagger.name,tagger.name);assert.equal(value.message,'release');
});
for(const target of ['refs/tags/new','refs/tags/new/child','refs/tags/parent','logs/refs/tags/new','logs/refs/tags/parent','refs/tags/NEW','logs/refs/tags/NEW'])test('namespace collision '+target,async t=>{
 const f=await fixture(t),p=f.file('.git',...target.split('/'));await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,f.head+'\n');
 await assert.rejects(f.preview(target.endsWith('/parent')?'parent/child':'new'),/collision/);
});
test('empty target directory rejected and existing safe nested prefixes accepted',async t=>{
 const f=await fixture(t);await fs.mkdir(f.file('.git','refs','tags','new'),{recursive:true});await assert.rejects(f.preview(),/collision/);
 await fs.mkdir(f.file('.git','logs','refs','tags','feature'),{recursive:true});await fs.mkdir(f.file('.git','refs','tags','feature'));
 assert.equal((await f.preview('feature/新')).name,'feature/新');
});
for(const target of ['packed-refs','PACKED-REFS','reftable','commondir','sharedindex.123','hooks/pre-commit','objects/info/alternates','HEAD.lock'])test('conservative unsupported metadata '+target,async t=>{
 const f=await fixture(t),p=f.file('.git',...target.split('/'));await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,'unsupported');let calls=0;observe=()=>calls++;
 await assert.rejects(f.preview(),/Unsupported/);assert.equal(calls,0);
});
for(const kind of ['HEAD','config','namespace','target','log','objects'])test('change during raw target read '+kind,async t=>{
 const f=await fixture(t);let reads=0;
 observe=(args,child)=>{if(args[0]==='cat-file'&&++reads===2)child.once('close',()=>{
  if(kind==='HEAD')syncfs.appendFileSync(f.file('.git','HEAD'),'\n');
  if(kind==='config')syncfs.appendFileSync(f.file('.git','config'),'\n# changed\n');
  if(kind==='namespace')syncfs.mkdirSync(f.file('.git','refs','tags','other'),{recursive:true});
  if(kind==='target'){syncfs.mkdirSync(f.file('.git','refs','tags'),{recursive:true});syncfs.writeFileSync(f.file('.git','refs','tags','new'),f.head+'\n');}
  if(kind==='log'){syncfs.mkdirSync(f.file('.git','logs','refs','tags'),{recursive:true});syncfs.writeFileSync(f.file('.git','logs','refs','tags','new'),'log');}
  if(kind==='objects')syncfs.writeFileSync(f.file('.git','objects','unexpected'),'opaque');
 });};await assert.rejects(f.preview(),/Stale|symbolic|collision/);
});
test('final closure catches metadata insertion after last latest read',async t=>{
 const f=await fixture(t);let reads=0;observe=(args,child)=>{if(args[0]==='check-ref-format'&&++reads===4)child.once('close',()=>syncfs.writeFileSync(f.file('.git','objects','late'),'opaque'));};await assert.rejects(f.preview(),/Stale/);
});
test('oversized immediate metadata fanout refused before child lstat',async t=>{
 const f=await fixture(t);let childVisits=0;
 listing=p=>p===f.file('.git')?Promise.resolve(Array.from({length:20001},(_,i)=>'fanout'+i)):undefined;
 io=()=>childVisits++;let commands=0;observe=()=>commands++;
 await assert.rejects(f.preview(),/limit/);assert.equal(commands,0);assert.ok(childVisits<=3);
});
test('raw fixed target hash mismatch is rejected',async t=>{
 const f=await fixture(t);let reads=0;
 observe=(args,child)=>{if(args[0]==='cat-file'&&++reads===2)child.stdout.on('data',bytes=>{bytes[0]^=1;});};
 await assert.rejects(f.preview(),/mismatch/);
});
for(const kind of ['malformed','signed'])test(kind+' real commit target rejected',async t=>{
 const f=await fixture(t);
 const body='tree '+f.tree+'\nauthor A <a@invalid> 1700000000 +0000\ncommitter C <c@invalid> 1700000000 +0000\n'+(kind==='signed'?'gpgsig -----BEGIN PGP SIGNATURE-----\n fake\n':'unexpected unsupported\n')+'\nmessage\n';
 await fs.writeFile(f.file('body'),body);
 const oid=(await f.run('hash-object','-t','commit','-w','--',f.file('body'))).toString().trim();
 await fs.writeFile(f.file('.git',...f.ref.split('/')),oid+'\n');await fs.rm(f.file('body'));
 const before=await state(f.root);await assert.rejects(f.preview());assert.deepEqual(await state(f.root),before);
});
test('native preabort is pre-IO and in-flight cancellation inherits deadline',async t=>{
 let calls=0;io=()=>calls++;const c=new AbortController();c.abort();
 await assert.rejects(prepareTagCreate({type:'git',root:path.resolve('missing')},{name:'new',tagger,message:'release',signal:c.signal}));assert.equal(calls,0);io=undefined;
 const f=await fixture(t),active=new AbortController();observe=(args,child)=>{if(args[0]==='cat-file')child.once('close',()=>active.abort());};await assert.rejects(f.preview('new',{signal:active.signal}));observe=undefined;
 await assert.rejects(withOperationBudget({timeoutMs:1},()=>f.preview()),e=>e.code==='TIMEOUT');
});
