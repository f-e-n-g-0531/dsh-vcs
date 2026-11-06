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
import {readLatestCommit} from '../latest-commit.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
const spawn=cp.spawn,open=fs.open;let observe,opened,replace;
cp.spawn=(command,args,options)=>{
 const opts={...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-latest-no-global')}};
 const child=replace?.(command,args,opts)??spawn(command,args,opts);
 if(command==='git')observe?.(args.slice(4).filter(a=>!a.startsWith('--git-dir=')&&!a.startsWith('--work-tree=')),child);return child;
};
fs.open=async(...args)=>{opened?.push(args[0]);return open(...args);};syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;fs.open=open;syncBuiltinESMExports();});
test.afterEach(()=>{observe=opened=replace=undefined;});
async function fixture(t,format='sha1',born=true){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-latest-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const file=(...p)=>path.join(root,...p),run=(...args)=>git(root,args),repo={type:'git',root};
 await run('init','--object-format='+format);await run('config','core.autocrlf','false');
 const tree=(await run('mktree')).toString().trim();
 const ref=(await fs.readFile(file('.git','HEAD'),'utf8')).trim().slice(5);
 const author={name:'Original Author',email:'author@invalid',timestamp:1700000000,timezone:'+0800'};
 const committer={name:'Different Committer',email:'committer@invalid',timestamp:1700000600,timezone:'-0530'};
 async function commit({message='\uFEFFexact\r\nno final LF',parents=[],extra='',raw}={}){
  const body=raw??Buffer.from('tree '+tree+'\n'+parents.map(p=>'parent '+p+'\n').join('')+'author Original Author <author@invalid> 1700000000 +0800\ncommitter Different Committer <committer@invalid> 1700000600 -0530\n'+extra+'\n'+message);
  const input=file('fixture-body');await fs.writeFile(input,body);
  const oid=(await run('hash-object','-t','commit','-w','--',input)).toString().trim();
  await fs.writeFile(file('.git',...ref.split('/')),oid+'\n');await fs.rm(input);
  return oid;
 }
 const head=born?await commit():undefined;
 return {root,file,repo,run,ref,tree,head,author,committer,commit,read:(options)=>readLatestCommit(repo,options)};
}
async function state(root){
 const rows=[];async function walk(dir){for(const name of (await fs.readdir(dir)).sort()){
  const f=path.join(dir,name),s=await fs.lstat(f,{bigint:true});
  if(s.isDirectory())await walk(f);else rows.push([path.relative(root,f),String(s.ino),String(s.size),String(s.mtimeNs),String(s.ctimeNs),createHash('sha256').update(await fs.readFile(f)).digest('hex')]);
 }}await walk(root);return rows;
}
function frozen(v){if(v&&typeof v==='object'){assert.ok(Object.isFrozen(v));assert.ok(!Buffer.isBuffer(v));for(const k of Reflect.ownKeys(v))frozen(v[k]);}}
for(const format of ['sha1','sha256'])for(const parent of [false,true])test(format+' '+(parent?'one-parent':'root')+' exact frozen metadata and zero writes',async t=>{
 const f=await fixture(t,format),parents=parent?[f.head]:[],head=parent?await f.commit({parents}):f.head;
 await fs.writeFile(f.file('work'),'untracked working content');
 await fs.writeFile(f.file('.git','index'),Buffer.from('deliberately invalid index'));
 const before=await state(f.root),commands=[];opened=[];observe=args=>commands.push(args);
 const v=await f.read();frozen(v);
 assert.deepEqual(v,{head,ref:f.ref,objectFormat:format,tree:f.tree,parents,author:f.author,committer:f.committer,message:'\uFEFFexact\r\nno final LF',messageBytes:21});
 assert.deepEqual(Reflect.ownKeys(v),['head','ref','objectFormat','tree','parents','author','committer','message','messageBytes']);
 assert.ok(opened.every(p=>p.startsWith(f.file('.git')+path.sep)&&p!==f.file('.git','index')));
 assert.deepEqual(commands.filter(a=>a[0]==='cat-file'),[['cat-file','commit',head]]);
 assert.equal(commands.filter(a=>a[0]==='config').length,2);
 assert.deepEqual(commands[0],['config','--no-includes','--null','--list']);
 assert.ok(commands.every(a=>['config','rev-parse','check-ref-format','cat-file'].includes(a[0])));
 assert.deepEqual(await state(f.root),before);
});
test('missing index and opaque working tree are allowed; packed branch supported',async t=>{
 const f=await fixture(t);await fs.mkdir(f.file('nested'));await fs.writeFile(f.file('nested','.git'),'opaque');await fs.writeFile(f.file('.gitattributes'),'* filter=opaque');
 await f.run('pack-refs','--all');assert.equal((await f.read()).head,f.head);
});
for(const kind of ['unborn','detached'])test(kind+' HEAD refused without writes',async t=>{
 const f=await fixture(t,'sha1',kind!=='unborn');if(kind==='detached')await fs.writeFile(f.file('.git','HEAD'),f.head+'\n');
 const before=await state(f.root);await assert.rejects(f.read());assert.deepEqual(await state(f.root),before);
});
test('invalid records/getters never invoke getter or Git',async t=>{
 const f=await fixture(t);let calls=0,getters=0;observe=()=>calls++;
 const getter={type:'git',get root(){getters++;throw Error('getter');}};
 for(const r of [null,[],{type:'svn',root:f.root},{type:'git',root:'.'},getter,{...f.repo,extra:1},Object.create(f.repo)])await assert.rejects(readLatestCommit(r));
 for(const o of [null,[],{message:'not needed'},{author:{}},{signal:{}},{get signal(){getters++;throw Error('getter');}},Object.create({signal:undefined})])await assert.rejects(f.read(o));
 assert.equal(calls,0);assert.equal(getters,0);
});
test('caller records are snapshotted before first await',async t=>{
 const f=await fixture(t),repo={...f.repo},options={signal:undefined};const pending=readLatestCommit(repo,options);repo.root='invalid';repo.type='svn';options.signal={};assert.equal((await pending).head,f.head);
});
for(const setting of ['include.path','includeIf.gitdir:/.path','core.hooksPath','core.worktree','core.attributesFile','core.sshCommand','core.sharedRepository','remote.origin.promisor','extensions.partialclone','alias.cat-file'])test(setting+' refused before non-config Git',async t=>{
 const f=await fixture(t);await f.run('config',setting,'external');const commands=[];observe=args=>commands.push(args);
 await assert.rejects(f.read(),setting==='core.worktree'?/Unsupported repository configuration|cannot chdir/:/Unsupported repository configuration/);assert.deepEqual(commands,[['config','--no-includes','--null','--list']]);
});
for(const target of ['shallow','commondir','worktrees','index.lock','objects/info/alternates','objects/info/http-alternates','objects/pack/test.promisor','hooks/pre-commit','sharedindex.test'])test('metadata '+target+' refused before Git',async t=>{
 const f=await fixture(t);const p=f.file('.git',...target.split('/'));await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,'forbidden');let calls=0;observe=()=>calls++;await assert.rejects(f.read(),/Unsupported repository metadata/);assert.equal(calls,0);
});
test('linked Git metadata and shared hardlinked files refused',async t=>{
 const f=await fixture(t);await fs.link(f.file('.git','config'),f.file('config-link'));await assert.rejects(f.read(),/Linked or special/);
 await fs.rm(f.file('config-link'));const original=f.file('.git','config'),outside=f.file('outside-config');await fs.rename(original,outside);await fs.symlink(outside,original);await assert.rejects(f.read(),/Linked or special/);
});
test('gitfile/worktree root refused before Git',async t=>{
 const f=await fixture(t);const other=f.file('other');await fs.mkdir(other);await fs.writeFile(path.join(other,'.git'),'gitdir: '+f.file('.git'));let calls=0;observe=()=>calls++;await assert.rejects(readLatestCommit({type:'git',root:other}),/Embedded Git/);assert.equal(calls,0);
});
for(const phase of ['body','second-facts','closing'])test('stale HEAD at '+phase+' is rejected',async t=>{
 const f=await fixture(t);let facts=0,checks=0;observe=(args,child)=>{
  const mutate=args[0]==='cat-file'&&phase==='body'||args[0]==='rev-parse'&&++facts===2&&phase==='second-facts'||args[0]==='check-ref-format'&&++checks===2&&phase==='closing';
  if(mutate)child.once('close',()=>syncfs.appendFileSync(f.file('.git','HEAD'),'\n'));
 };await assert.rejects(f.read(),/Stale|symbolic/);
});
for(const kind of ['signed','message-bound','body-bound','invalid-utf8'])test(kind+' body refused without writes',async t=>{
 const f=await fixture(t);
 if(kind==='signed')await f.commit({extra:'gpgsig fake\n continuation\n'});
 if(kind==='message-bound')await f.commit({message:'x'.repeat(65537)});
 if(kind==='body-bound')await f.commit({message:'x'.repeat(2*1024*1024)});
 if(kind==='invalid-utf8'){const raw=Buffer.concat([Buffer.from('tree '+f.tree+'\nauthor A <a@x> 1 +0000\ncommitter C <c@x> 2 +0000\n\n'),Buffer.from([255])]);await f.commit({raw});}
 const before=await state(f.root);await assert.rejects(f.read());assert.deepEqual(await state(f.root),before);
});
test('raw commit independent hash check rejects wrong body despite valid grammar',async t=>{
 const f=await fixture(t),other=await f.commit({message:'different'});await fs.writeFile(f.file('.git',...f.ref.split('/')),f.head+'\n');
 replace=(command,args,opts)=>command==='git'&&args[4]==='cat-file'?spawn(command,[...args.slice(0,-1),other],opts):undefined;
 await assert.rejects(f.read(),/hash|oid|OID|mismatch/i);
});
test('already cancelled does no Git I/O',async t=>{
 const f=await fixture(t),c=new AbortController();c.abort();let calls=0;observe=()=>calls++;await assert.rejects(f.read({signal:c.signal}));assert.equal(calls,0);
});
for(const kind of ['cancel','deadline'])test(kind+' drains owned child before rejecting',async t=>{
 const f=await fixture(t),c=new AbortController();let child,closed=false;
 replace=(command,args,opts)=>{if(command!=='git')return;child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],opts);child.once('close',()=>{closed=true;});if(kind==='cancel')setTimeout(()=>c.abort(),25);return child;};
 const pending=kind==='cancel'?f.read({signal:c.signal}):withOperationBudget({timeoutMs:80},()=>f.read());
 await assert.rejects(pending,e=>kind==='deadline'?e.code==='TIMEOUT':e.code==='ABORT_ERR');assert.ok(child);assert.ok(closed);
});
