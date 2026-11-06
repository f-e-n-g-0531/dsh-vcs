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
import {prepareBranchDelete} from '../branch-delete-preview.mjs';
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
 await fs.writeFile(file('.git','refs','heads','new'),head+'\n');
 const commit=async(parents=[],message='child',extra='')=>{await fs.writeFile(file('body'),'tree '+tree+'\n'+parents.map(p=>'parent '+p+'\n').join('')+'author A <a@invalid> 1700000000 +0000\ncommitter C <c@invalid> 1700000000 +0000\n'+extra+'\n'+message);const oid=(await run('hash-object','-t','commit','-w','--',file('body'))).toString().trim();await fs.rm(file('body'));return oid;};
 const set=async(name,oid)=>fs.writeFile(file('.git',...name.split('/')),oid+'\n');
 return {repo,root,file,run,ref,head,commit,set,preview:(name='new',options={})=>prepareBranchDelete(repo,{name,...options})};
}
async function state(root){
 const rows=[];async function walk(dir){for(const name of (await fs.readdir(dir)).sort()){
  const file=path.join(dir,name),s=await fs.lstat(file,{bigint:true});
  rows.push([path.relative(root,file),String(s.ino),String(s.size),String(s.mtimeNs),String(s.ctimeNs),s.isFile()?createHash('sha256').update(await fs.readFile(file)).digest('hex'):null]);
  if(s.isDirectory())await walk(file);
 }}await walk(root);return rows;
}
for(const format of ['sha1','sha256'])for(const kind of ['root','linear','merge'])test(format+' '+kind+' merged frozen safe read-only projection',async t=>{
 const f=await fixture(t,format);let current=f.head,target=f.head;
 if(kind==='linear')current=await f.commit([target]);
 if(kind==='merge'){const left=await f.commit([f.head],'left');target=await f.commit([f.head],'right');current=await f.commit([left,target],'merge');}
 await f.set(f.ref,current);await f.set('refs/heads/new',target);
 await fs.writeFile(f.file('work'),'opaque');await fs.writeFile(f.file('.git','index'),'invalid index');
 const before=await state(f.root),commands=[];opened=[];observe=(a,c)=>{commands.push(a);assert.equal(c.spawnargs.includes('--no-pager'),true);};
 const value=await f.preview();
 assert.deepEqual(Object.keys(value),['action','name','ref','objectFormat','current','target','merged','proof','planId']);
 assert.equal(value.action,'branch-delete');assert.equal(value.name,'new');assert.equal(value.ref,'refs/heads/new');assert.equal(value.objectFormat,format);
 assert.deepEqual(value.current,{ref:f.ref,oid:current});assert.deepEqual(value.target,{ref:'refs/heads/new',oid:target});assert.equal(value.merged,true);
 assert.equal(value.proof[0],current);assert.equal(value.proof.at(-1),target);assert.match(value.planId,/^[a-f0-9]{64}$/);
 for(const v of [value,value.current,value.target,value.proof])assert.ok(Object.isFrozen(v));
 assert.ok(commands.every(a=>['config','rev-parse','check-ref-format','cat-file'].includes(a[0])));
 assert.ok(commands.filter(a=>a[0]==='cat-file').every(a=>a.length===3&&a[1]==='commit'&&new RegExp('^[a-f0-9]{'+current.length+'}$').test(a[2])));
 assert.ok(opened.every(([p,flags])=>p.startsWith(f.file('.git')+path.sep)&&p!==f.file('.git','index')&&flags===(syncfs.constants.O_RDONLY|(syncfs.constants.O_NOFOLLOW||0))));
 assert.deepEqual(await state(f.root),before);observe=undefined;opened=undefined;
 assert.equal((await f.preview()).planId,value.planId);
});
for(const format of ['sha1','sha256'])test(format+' unmerged target rejected, no force',async t=>{const f=await fixture(t,format);const unmerged=await f.commit([f.head]);await f.set('refs/heads/new',unmerged);await assert.rejects(f.preview(),/not merged/);});
const invalid=['','@','HEAD','head','-foo','refs/heads/new','a..b','a@{b','a//b','a/','/a','.git','x/.a','a.lock','con','AUX.txt','a.','a b','a\\b','a:b','a?b','a*b','a[b','a~b','a^b','a\n','a\u007f','a\u200b','\ud800','a'.repeat(256),'安'.repeat(334)];
for(const name of invalid)test('early invalid name '+JSON.stringify(name),async()=>{let calls=0;io=()=>calls++;observe=()=>calls++;await assert.rejects(prepareBranchDelete({type:'git',root:path.resolve('missing')},{name}));assert.equal(calls,0);});
test('strict records/accessors and caller OID/ref/graph refused before IO',async()=>{
 let calls=0,getters=0;io=()=>calls++;observe=()=>calls++;const r={type:'git',root:path.resolve('missing')};
 for(const repo of [null,[],Object.create(r),{...r,extra:1},{...r,[Symbol()]:1},{type:'svn',root:r.root},{type:'git',root:'.'},{type:'git',get root(){getters++;}}])await assert.rejects(prepareBranchDelete(repo,{name:'new'}));
 for(const o of [null,[],{},Object.create({name:'new'}),{name:'new',oid:'a'.repeat(40)},{name:'new',ref:'refs/heads/new'},{name:'new',graph:[]},{name:'new',force:true},{name:'new',signal:{}},{get name(){getters++;}},{name:'new',get signal(){getters++;}}])await assert.rejects(prepareBranchDelete(r,o));
 assert.equal(calls,0);assert.equal(getters,0);
});
test('inputs captured synchronously',async t=>{const f=await fixture(t),r={...f.repo},o={name:'new'};const promise=prepareBranchDelete(r,o);r.root='bad';o.name='bad..';assert.equal((await promise).name,'new');});
for(const kind of ['symbolic','zero','uppercase','extra-newline','high-byte','oversized','directory','missing','alias','current','current-alias','hardlink'])test('unsafe target '+kind,async t=>{
 const f=await fixture(t),target=f.file('.git','refs','heads','new');let name='new';
 if(kind==='symbolic')await fs.writeFile(target,'ref: '+f.ref+'\n');
 if(kind==='zero')await fs.writeFile(target,'0'.repeat(40)+'\n');
 if(kind==='uppercase')await fs.writeFile(target,f.head.toUpperCase()+'\n');
 if(kind==='extra-newline')await fs.appendFile(target,'\n');
 if(kind==='high-byte')await fs.writeFile(target,Buffer.from([...Buffer.from(f.head)].map(c=>c|128)));
 if(kind==='oversized')await fs.writeFile(target,'a'.repeat(66));
 if(kind==='directory'){await fs.rm(target);await fs.mkdir(target);}
 if(kind==='missing')await fs.rm(target);
 if(kind==='alias')name='NEW';
 if(kind==='current')name=f.ref.slice(11);
 if(kind==='current-alias')name=f.ref.slice(11).toUpperCase();
 if(kind==='hardlink'){await fs.rm(target);await fs.link(f.file('.git',...f.ref.split('/')),target);}
 await assert.rejects(f.preview(name));
});
for(const name of ['packed-refs','reftable','index.lock','sharedindex.x','commondir','worktrees','shallow','hooks/pre-commit','objects/info/alternates','objects/pack/test.promisor'])test('conservative metadata '+name,async t=>{
 const f=await fixture(t),p=f.file('.git',...name.split('/'));await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,'unsupported');let calls=0;observe=()=>calls++;await assert.rejects(f.preview(),/Unsupported/);assert.equal(calls,0);
});
for(const kind of ['malformed','signed','missing','oversized'])test('strict parent graph '+kind,async t=>{
 const f=await fixture(t);let bad;
 if(kind==='missing')bad='a'.repeat(40);
 else if(kind==='signed')bad=await f.commit([],'signed','gpgsig signature\n continued\n');
 else if(kind==='oversized')bad=await f.commit([],'x'.repeat(2*1024*1024));
 else{await fs.writeFile(f.file('body'),'bad commit');bad=(await f.run('hash-object','--literally','-t','commit','-w','--',f.file('body'))).toString().trim();await fs.rm(f.file('body'));}
 const current=await f.commit([f.head,bad]);await f.set(f.ref,current);
 await assert.rejects(f.preview());
});
for(const kind of ['HEAD','target','config','object','index','unrelated'])for(const stage of ['traversal','final'])test('stale '+kind+' during '+stage,async t=>{
 const f=await fixture(t);let reads=0,changed=false;
 observe=(args,child)=>{if(args[0]==='cat-file'&&++reads===(stage==='traversal'?2:3))child.once('close',()=>{
  changed=true;
  if(kind==='HEAD')syncfs.appendFileSync(f.file('.git','HEAD'),'\n');
  if(kind==='target')syncfs.writeFileSync(f.file('.git','refs','heads','new'),f.head);
  if(kind==='config')syncfs.appendFileSync(f.file('.git','config'),'\n# stale\n');
  if(kind==='object')syncfs.writeFileSync(f.file('.git','objects','observed-change'),'x');
  if(kind==='index')syncfs.writeFileSync(f.file('.git','index'),'x');
  if(kind==='unrelated')syncfs.writeFileSync(f.file('.git','refs','heads','unrelated'),f.head+'\n');
 });};
 await assert.rejects(f.preview());assert.ok(changed);
});
test('cancellation pre-aborted performs no IO',async()=>{const c=new AbortController();c.abort();let calls=0;io=()=>calls++;await assert.rejects(prepareBranchDelete({type:'git',root:path.resolve('missing')},{name:'new',signal:c.signal}));assert.equal(calls,0);});
test('abort during graph command',async t=>{const f=await fixture(t),c=new AbortController();let reads=0;observe=a=>{if(a[0]==='cat-file'&&++reads===2)c.abort();};await assert.rejects(f.preview('new',{signal:c.signal}));});
test('nested shared operation deadline is not reset',async t=>{const f=await fixture(t);await assert.rejects(withOperationBudget({timeoutMs:1},()=>f.preview()),e=>e.code==='TIMEOUT');});
 test('target-side ancestry also requires closed graph even when unmerged',async t=>{const f=await fixture(t),target=await f.commit(['b'.repeat(40)]);await f.set('refs/heads/new',target);await assert.rejects(f.preview(),e=>e.code==='VCS_COMMAND');});
 test('aggregate 16MiB limit includes BOTH tips and rejects before unmerged decision',async t=>{
  const f=await fixture(t);let tip=f.head;for(let i=0;i<9;i++)tip=await f.commit([tip],String(i)+'x'.repeat(1900000));await f.set('refs/heads/new',tip);
  await assert.rejects(f.preview(),e=>e.code==='TOO_LARGE'||/Aggregate/.test(e.message));
 });
 test('metadata scan 20k entry ceiling is enforced before any Git',async t=>{
  const f=await fixture(t),readdir=fs.readdir;await fs.writeFile(f.file('.git','index'),'opaque');let commands=0;
  fs.readdir=async(p,...args)=>p===f.file('.git')?Array(20001).fill('index'):readdir(p,...args);syncBuiltinESMExports();observe=()=>commands++;
  try{await assert.rejects(f.preview(),/Metadata inspection limit/);assert.equal(commands,0);}finally{fs.readdir=readdir;syncBuiltinESMExports();}
 });
