import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs/promises';
import syncfs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {git} from '../local-command.mjs';
import {prepareBranchDelete,applyBranchDelete} from '../branch-delete-preview.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
const spawn=cp.spawn;let commands;
cp.spawn=(command,args,options)=>{
 if(command==='git')commands?.push(args);
 return spawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-delete-confirm-no-global')}});
};syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});test.afterEach(()=>{commands=undefined;});
async function fixture(t,format='sha1',name='target'){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-delete-confirm-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const file=(...p)=>path.join(root,...p),run=(...a)=>git(root,a),repo={type:'git',root};
 await run('init','--object-format='+format);await run('config','core.autocrlf','false');
 const tree=(await run('mktree')).toString().trim(),ref=(await fs.readFile(file('.git','HEAD'),'utf8')).trim().slice(5);
 const commit=async(parents=[],message='root')=>{
  await fs.writeFile(file('body'),'tree '+tree+'\n'+parents.map(p=>'parent '+p+'\n').join('')+'author A <a@invalid> 1700000000 +0000\ncommitter C <c@invalid> 1700000000 +0000\n\n'+message+'\n');
  const oid=(await run('hash-object','-t','commit','-w','--',file('body'))).toString().trim();await fs.rm(file('body'));return oid;
 };
 const head=await commit(),left=await commit([head],'left'),right=await commit([head],'right'),current=await commit([left,right],'merge'),target=right;
 const put=async(rel,text)=>{const p=file('.git',...rel.split('/'));await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,text);};
 await put(ref,current+'\n');await put('refs/heads/'+name,target+'\n');
 await put('logs/HEAD','head log\n');await put('logs/'+ref,'current log\n');await put('logs/refs/heads/'+name,'target log\n');
 await put('index','opaque index');await put('info/other','unrelated');await fs.writeFile(file('work'),'worktree bytes');
 const preview=()=>prepareBranchDelete(repo,{name});
 const apply=(snapshot,options={})=>applyBranchDelete(repo,{snapshot,assertAuthorized(){},onStart(){},...options});
 return {root,repo,file,run,ref,name,target,current,head,commit,put,preview,apply};
}
async function state(root){
 const rows=[];async function walk(dir,rel=''){
  for(const name of (await fs.readdir(dir)).sort()){
   const p=path.join(dir,name),key=rel?rel+'/'+name:name,s=await fs.lstat(p,{bigint:true});
   rows.push([key,[s.dev,s.ino,s.birthtimeNs,s.size,s.mtimeNs,s.ctimeNs,s.mode].map(String),s.isFile()?(await fs.readFile(p)).toString('hex'):null]);
   if(s.isDirectory())await walk(p,key);
  }
 }await walk(root);return rows;
}
const unknown=e=>e.code==='vcs/branch-delete-outcome-unknown'&&e.outcomeUnknown===true;
const missing=async p=>assert.rejects(fs.lstat(p),{code:'ENOENT'});
for(const format of ['sha1','sha256'])for(const name of ['target','nested/only/target'])test(format+' '+name+' merged deletion changes only target/log and ancestors',async t=>{
 const f=await fixture(t,format,name),snapshot=await f.preview(),before=await state(f.root);commands=[];let starts=0,auth=0;
 const result=await f.apply(snapshot,{onStart(){starts++;},assertAuthorized(){auth++;}});
 assert.deepEqual(result,{name,ref:'refs/heads/'+name,deletedOid:f.target,currentRef:f.ref,currentOid:f.current});assert.ok(Object.isFrozen(result));assert.equal(starts,1);assert.equal(auth,5);
 await missing(f.file('.git','refs','heads',...name.split('/')));await missing(f.file('.git','logs','refs','heads',...name.split('/')));
 const leaves=['.git/refs/heads/'+name,'.git/logs/refs/heads/'+name],ancestors=new Set();for(let p of leaves)while(p.includes('/')){p=p.slice(0,p.lastIndexOf('/'));ancestors.add(p);}
 const after=new Map((await state(f.root)).map(row=>[row[0],row]));
 for(const row of before){if(leaves.includes(row[0]))continue;if(ancestors.has(row[0])){if(after.has(row[0]))assert.deepEqual(after.get(row[0])[1].filter((_,i)=>[0,1,2,6].includes(i)),row[1].filter((_,i)=>[0,1,2,6].includes(i)));}else assert.deepEqual(after.get(row[0]),row);}
 assert.equal(commands.filter(a=>a.includes('update-ref')).length,1);assert.ok(!commands.some(a=>a.includes('checkout')));
 await assert.rejects(f.apply(snapshot),/Exact unused/);
});
test('clones/prototypes/bindings are not capabilities; exact identity consumed synchronously',async t=>{
 const f=await fixture(t),s=await f.preview();
 for(const clone of [{...s},structuredClone(s),Object.create(s),new Proxy(s,{})])await assert.rejects(f.apply(clone),/Exact unused/);
 const p=f.apply(s,{assertAuthorized(){throw Error('denied');}});await assert.rejects(f.apply(s),/Exact unused/);await assert.rejects(p,/denied/);
 const other=await fixture(t),s2=await f.preview();await assert.rejects(applyBranchDelete(other.repo,{snapshot:s2,assertAuthorized(){},onStart(){}}));await assert.rejects(f.apply(s2),/Exact unused/);
});
for(const kind of ['override','accessor','symbol','badSignal','badCallback','badRepo','inherited'])test('bad '+kind+' burns valid capability without invoking accessors',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let gets=0;let repo=f.repo,o={snapshot,assertAuthorized(){},onStart(){}};
 if(kind==='override')o.expectedOid=f.head;
 if(kind==='accessor')Object.defineProperty(o,'signal',{get(){gets++;}});
 if(kind==='symbol')o[Symbol()]=1;
 if(kind==='badSignal')o.signal={};
 if(kind==='badCallback')o.onStart=null;
 if(kind==='badRepo')repo={...repo,extra:1};
 if(kind==='inherited')Object.setPrototypeOf(o,{extra:1});
 await assert.rejects(applyBranchDelete(repo,o));assert.equal(gets,0);await assert.rejects(f.apply(snapshot),/Exact unused/);
});
const mutate={
 HEAD:f=>f.put('HEAD','ref: refs/heads/other\n'),target:f=>f.put('refs/heads/'+f.name,f.head+'\n'),config:f=>fs.appendFile(f.file('.git','config'),'\n# changed\n'),
 objects:async f=>{const p=f.file('.git','objects',f.head.slice(0,2),f.head.slice(2));await fs.chmod(p,0o600);await fs.appendFile(p,Buffer.from([0]));},index:f=>f.put('index','changed index'),unrelated:f=>f.put('info/other','changed'),
 currentlog:f=>f.put('logs/'+f.ref,'changed log'),addition:f=>f.put('info/added','added'),disappearance:f=>fs.rm(f.file('.git','info','other'))
};
for(const [kind,change] of Object.entries(mutate))for(const when of ['before','last-preauth'])test('stale '+kind+' '+when+' prevents start and burns',async t=>{
 const f=await fixture(t),s=await f.preview();let auth=0,starts=0;if(when==='before')await change(f);
 await assert.rejects(f.apply(s,{assertAuthorized:async()=>{if(++auth===2&&when==='last-preauth')await change(f);},onStart(){starts++;}}));assert.equal(starts,0);await assert.rejects(f.apply(s),/Exact unused/);assert.ok(await fs.lstat(f.file('.git','refs','heads',f.name)));
});
for(const kind of ['direct','symbolic'])test('onStart '+kind+' competitor observed: unknown and retained',async t=>{
 const f=await fixture(t),s=await f.preview(),text=kind==='direct'?f.head+'\n':'ref: '+f.ref+'\n';
 await assert.rejects(f.apply(s,{onStart(){syncfs.writeFileSync(f.file('.git','refs','heads',f.name),text);}}),unknown);
 assert.equal(await fs.readFile(f.file('.git','refs','heads',f.name),'utf8'),text);assert.equal(await fs.readFile(f.file('.git',...f.ref.split('/')),'utf8'),f.current+'\n');
});
for(const kind of ['unrelated','addition','disappearance'])test('post-start external '+kind+' causes unknown, never rollback',async t=>{
 const f=await fixture(t),s=await f.preview();let started=false;
 await assert.rejects(f.apply(s,{onStart(){started=true;},assertAuthorized:async()=>{if(started)await mutate[kind](f);}}),unknown);await missing(f.file('.git','refs','heads',f.name));
});
for(const kind of ['HEAD','config','currentlog','objects','recreated'])test('final authorization '+kind+' change rejected and retained',async t=>{
 const f=await fixture(t),s=await f.preview();let auth=0;
 await assert.rejects(f.apply(s,{assertAuthorized:async()=>{if(++auth===5){if(kind==='recreated')await f.put('refs/heads/'+f.name,f.head+'\n');else await mutate[kind](f);}}}),unknown);
 assert.equal(auth,5);if(kind==='recreated')assert.equal(await fs.readFile(f.file('.git','refs','heads',f.name),'utf8'),f.head+'\n');else await missing(f.file('.git','refs','heads',f.name));
});
for(const when of ['pre','post','start'])test('cancel '+when+' consumes authority and classifies boundary',async t=>{
 const f=await fixture(t),s=await f.preview(),controller=new AbortController();let started=false;
 if(when==='pre')controller.abort();
 await assert.rejects(f.apply(s,{signal:controller.signal,onStart(){started=true;if(when==='start')controller.abort();},assertAuthorized(){if(started&&when==='post')controller.abort();}}),when==='pre'?e=>e.name==='AbortError':unknown);
 await assert.rejects(f.apply(s),/Exact unused/);if(when!=='post')assert.ok(await fs.lstat(f.file('.git','refs','heads',f.name)));
});
test('onStart thenable is unknown and target retained',async t=>{const f=await fixture(t),s=await f.preview();await assert.rejects(f.apply(s,{onStart(){return Promise.reject(Error('async start'));}}),unknown);assert.ok(await fs.lstat(f.file('.git','refs','heads',f.name)));});
for(const when of ['pre','start'])test('shared budget expiry '+when,async t=>{
 const f=await fixture(t),s=await f.preview();
 await assert.rejects(withOperationBudget({timeoutMs:when==='pre'?1:15000},()=>f.apply(s,{onStart(){const until=performance.now()+15010;while(performance.now()<until){};},assertAuthorized(){if(when==='pre'){const until=performance.now()+5;while(performance.now()<until){}}}})),when==='pre'?e=>e.code==='TIMEOUT':unknown);
});
