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
import {prepareBranchCreate,applyBranchCreate} from '../branch-create-preview.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
const spawn=cp.spawn;let observe;
cp.spawn=(command,args,options)=>{
 const child=spawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-branch-confirm-no-global')}});
 if(command==='git')observe?.(args,child);return child;
};syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
test.afterEach(()=>{observe=undefined;});
async function fixture(t,format='sha1'){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-branch-confirm-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const file=(...p)=>path.join(root,...p),run=(...a)=>git(root,a),repo={type:'git',root};
 await run('init','--object-format='+format);await run('config','core.autocrlf','false');
 const tree=(await run('mktree')).toString().trim(),ref=(await fs.readFile(file('.git','HEAD'),'utf8')).trim().slice(5);
 await fs.writeFile(file('body'),'tree '+tree+'\nauthor A <a@invalid> 1700000000 +0000\ncommitter C <c@invalid> 1700000000 +0000\n\nconfirm\n');
 const head=(await run('hash-object','-t','commit','-w','--',file('body'))).toString().trim();
 await fs.writeFile(file('.git',...ref.split('/')),head+'\n');await fs.rm(file('body'));
 return {repo,root,file,run,head,ref,preview:(name='new')=>prepareBranchCreate(repo,{name})};
}
const options=snapshot=>({snapshot,assertAuthorized:()=>{},onStart:()=>{}});
const unknown=e=>e.code==='vcs/branch-create-outcome-unknown'&&e.outcomeUnknown===true;
const pre=e=>e.outcomeUnknown!==true;
async function unchangedTree(root){
 const rows=[];async function walk(dir){for(const name of (await fs.readdir(dir)).sort()){
  const p=path.join(dir,name),s=await fs.lstat(p,{bigint:true});
  rows.push([path.relative(root,p),...[s.dev,s.ino,s.birthtimeNs,s.size,s.mtimeNs,s.ctimeNs,s.mode].map(String),s.isFile()?createHash('sha256').update(await fs.readFile(p)).digest('hex'):null]);
  if(s.isDirectory())await walk(p);
 }}await walk(root);return rows;
}
for(const format of ['sha1','sha256'])test(format+' exact summary binding, nested Unicode create; no checkout/work/index/object changes',async t=>{
 const f=await fixture(t,format);await fs.writeFile(f.file('work'),'opaque work');await fs.writeFile(f.file('.git','index'),'opaque invalid index');
 const objectBefore=await unchangedTree(f.file('.git','objects')),indexBefore=await fs.readFile(f.file('.git','index')),headBefore=await fs.readFile(f.file('.git','HEAD'));
 const snapshot=await f.preview('feature/安全-é');let starts=0,auth=0;const commands=[];observe=args=>commands.push(args);
 const result=await applyBranchCreate({...f.repo},{snapshot,assertAuthorized:()=>{auth++;},onStart:()=>{starts++;}});
 assert.deepEqual(result,{name:snapshot.name,ref:snapshot.ref,commit:f.head,currentRef:f.ref});
 assert.equal(starts,1);assert.ok(auth>=5);assert.equal(await fs.readFile(f.file('.git',...snapshot.ref.split('/')),'utf8'),f.head+'\n');
 assert.deepEqual(await fs.readFile(f.file('.git','HEAD')),headBefore);assert.deepEqual(await fs.readFile(f.file('.git','index')),indexBefore);
 assert.equal(await fs.readFile(f.file('work'),'utf8'),'opaque work');assert.deepEqual(await unchangedTree(f.file('.git','objects')),objectBefore);
 assert.equal(commands.filter(a=>a.includes('update-ref')).length,1);assert.ok(commands.every(a=>!a.includes('checkout')&&!a.includes('switch')));
 await assert.rejects(applyBranchCreate(f.repo,options(snapshot)),pre);
});
test('clones have no authority; original remains usable, identical repo record binds',async t=>{
 const f=await fixture(t),snapshot=await f.preview();
 for(const clone of [{...snapshot},structuredClone(snapshot)])await assert.rejects(applyBranchCreate(f.repo,options(clone)),pre);
 await applyBranchCreate({...f.repo},options(snapshot));
});
for(const kind of ['wrong repo','bad repo','bad callback','extra name','extra oid','extra symbol','signal','accessor callback'])test(kind+' rejects and burns synchronously',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let getters=0;
 const o=options(snapshot);let r=f.repo;
 if(kind==='wrong repo')r=(await fixture(t)).repo;
 if(kind==='bad repo')r={...r,extra:true};
 if(kind==='bad callback')o.assertAuthorized=null;
 if(kind==='extra name')o.name='override';
 if(kind==='extra oid')o.commit=f.head;
 if(kind==='extra symbol')o[Symbol()]=1;
 if(kind==='signal')o.signal={};
 if(kind==='accessor callback')Object.defineProperty(o,'assertAuthorized',{get(){getters++;return ()=>{};}});
 const pending=applyBranchCreate(r,o);await assert.rejects(applyBranchCreate(f.repo,options(snapshot)),pre);await assert.rejects(pending,pre);
 assert.equal(getters,0);await assert.rejects(fs.stat(f.file('.git','refs','heads','new')),{code:'ENOENT'});
});
test('snapshot getter never executes, inherited fields rejected',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let gets=0;
 await assert.rejects(applyBranchCreate(f.repo,{get snapshot(){gets++;return snapshot;},assertAuthorized:()=>{},onStart:()=>{}}),pre);
 await assert.rejects(applyBranchCreate(Object.create(f.repo),options(snapshot)),pre);assert.equal(gets,0);
 await assert.rejects(applyBranchCreate(f.repo,options(snapshot)),pre);
});
async function mutate(f,kind){
 if(kind==='HEAD')await fs.appendFile(f.file('.git','HEAD'),'\n');
 if(kind==='config')await fs.appendFile(f.file('.git','config'),'\n# changed\n');
 if(kind==='namespace')await fs.mkdir(f.file('.git','refs','heads','foreign'));
 if(kind==='target')await fs.writeFile(f.file('.git','refs','heads','new'),f.head+'\n');
 if(kind==='current ref')await fs.appendFile(f.file('.git',...f.ref.split('/')),'\n');
}
for(const timing of ['before apply','first authorization','last prestart authorization'])for(const kind of ['HEAD','config','namespace','target','current ref'])test(timing+' '+kind+' stale fails before start',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let calls=0,starts=0;
 if(timing==='before apply')await mutate(f,kind);
 await assert.rejects(applyBranchCreate(f.repo,{snapshot,assertAuthorized:async()=>{
  calls++;if(calls===(timing==='first authorization'?1:timing==='last prestart authorization'?2:-1))await mutate(f,kind);
 },onStart:()=>{starts++;}}),pre);assert.equal(starts,0);
 await assert.rejects(applyBranchCreate(f.repo,options(snapshot)),pre);
});
for(const symbolic of [false,true])test('onStart '+(symbolic?'symbolic':'direct')+' target race is unknown and never overwrites/deletes competitor',async t=>{
 const f=await fixture(t),snapshot=await f.preview(),content=symbolic?'ref: '+f.ref+'\n':f.head+'\n';let starts=0;
 await assert.rejects(applyBranchCreate(f.repo,{snapshot,assertAuthorized:()=>{},onStart:()=>{starts++;syncfs.writeFileSync(f.file('.git','refs','heads','new'),content);}}),unknown);
 assert.equal(starts,1);assert.equal(await fs.readFile(f.file('.git','refs','heads','new'),'utf8'),content);
 await assert.rejects(applyBranchCreate(f.repo,options(snapshot)),pre);
});
for(const phase of ['postcreate','final authorization'])test(phase+' foreign namespace addition unknown without rollback',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let auth=0;
 await assert.rejects(applyBranchCreate(f.repo,{snapshot,assertAuthorized:async()=>{
  if(++auth===(phase==='postcreate'?3:5))await fs.writeFile(f.file('.git','refs','heads','foreign'),f.head+'\n');
 },onStart:()=>{}}),unknown);
 assert.equal(await fs.readFile(f.file('.git','refs','heads','new'),'utf8'),f.head+'\n');
 assert.equal(await fs.readFile(f.file('.git','refs','heads','foreign'),'utf8'),f.head+'\n');
});
for(const phase of ['pre','preauth','postauth','finalauth'])test('cancellation '+phase+' burns with correct outcome boundary',async t=>{
 const f=await fixture(t),snapshot=await f.preview(),controller=new AbortController();let auth=0,starts=0;
 if(phase==='pre')controller.abort();
 await assert.rejects(applyBranchCreate(f.repo,{snapshot,signal:controller.signal,assertAuthorized:()=>{
  if(++auth===({preauth:2,postauth:3,finalauth:5}[phase]))controller.abort();
 },onStart:()=>{starts++;}}),phase==='postauth'||phase==='finalauth'?unknown:pre);
 assert.equal(starts,phase==='postauth'||phase==='finalauth'?1:0);
 await assert.rejects(applyBranchCreate(f.repo,options(snapshot)),pre);
});
for(const phase of [1,2,3,4,5])test('authorization failure '+phase+' boundary',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let auth=0;
 await assert.rejects(applyBranchCreate(f.repo,{snapshot,assertAuthorized:()=>{if(++auth===phase)throw Error('denied');},onStart:()=>{}}),phase<=2?pre:unknown);
});
for(const kind of ['throw','async','cancel'])test('onStart '+kind+' is unknown',async t=>{
 const f=await fixture(t),snapshot=await f.preview(),c=new AbortController();
 await assert.rejects(applyBranchCreate(f.repo,{snapshot,signal:c.signal,assertAuthorized:()=>{},onStart:()=>{
  if(kind==='throw')throw Error('start failed');if(kind==='async')return Promise.resolve();c.abort();
 }}),unknown);
});
for(const kind of ['HEAD','config','old ref','old log','target symref','target hardlink','ancestor replacement'])test('final authorization mutation '+kind+' remains unknown against original baseline',async t=>{
 const f=await fixture(t);await fs.mkdir(f.file('.git','logs','refs','heads'),{recursive:true});
 await fs.writeFile(f.file('.git','logs','HEAD'),'original HEAD log\n');
 const snapshot=await f.preview();let auth=0;
 await assert.rejects(applyBranchCreate(f.repo,{snapshot,assertAuthorized:async()=>{
  if(++auth!==5)return;
  if(kind==='HEAD')await fs.appendFile(f.file('.git','HEAD'),'\n');
  if(kind==='config')await fs.appendFile(f.file('.git','config'),'\n# late config\n');
  if(kind==='old ref')await fs.appendFile(f.file('.git',...f.ref.split('/')),'\n');
  if(kind==='old log')await fs.appendFile(f.file('.git','logs','HEAD'),'late\n');
  if(kind==='target symref')await fs.writeFile(f.file('.git','refs','heads','new'),'ref: '+f.ref+'\n');
  if(kind==='target hardlink')await fs.link(f.file('.git','refs','heads','new'),f.file('linked-target'));
  if(kind==='ancestor replacement'){
   await fs.rename(f.file('.git','logs','refs','heads'),f.file('old-log-heads'));
   await fs.mkdir(f.file('.git','logs','refs','heads'));
   await fs.copyFile(f.file('old-log-heads','new'),f.file('.git','logs','refs','heads','new'));
  }
 },onStart:()=>{}}),unknown);
 await assert.rejects(applyBranchCreate(f.repo,options(snapshot)),pre);
});
test('nested inherited deadline is not reset and consumes snapshot',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let starts=0;
 await assert.rejects(withOperationBudget({timeoutMs:1},()=>applyBranchCreate(f.repo,{snapshot,assertAuthorized:()=>{},onStart:()=>{starts++;}})),e=>e.code==='TIMEOUT');
 assert.equal(starts,0);await assert.rejects(applyBranchCreate(f.repo,options(snapshot)),pre);
});
