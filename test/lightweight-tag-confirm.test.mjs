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
import {prepareLightweightTagCreate,applyLightweightTagCreate} from '../lightweight-tag-preview.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
const spawn=cp.spawn,open=fs.open,lstat=fs.lstat,readdir=fs.readdir;let observe,opened,io,listing,globalConfig;
cp.spawn=(command,args,options)=>{
 const child=spawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:globalConfig??path.join(os.tmpdir(),'dsh-lightweight-preview-no-global')}});
 if(command==='git')observe?.(args.slice(4).filter(a=>!a.startsWith('--git-dir=')&&!a.startsWith('--work-tree=')),child);return child;
};
fs.open=async(...args)=>{opened?.push(args);return open(...args);};
fs.lstat=async(...args)=>{io?.();return lstat(...args);};syncBuiltinESMExports();
fs.readdir=async(...args)=>listing?.(...args)??readdir(...args);syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;fs.open=open;fs.lstat=lstat;fs.readdir=readdir;syncBuiltinESMExports();});
test.afterEach(()=>{observe=opened=io=listing=globalConfig=undefined;});
async function fixture(t,format='sha1'){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-lightweight-preview-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const file=(...p)=>path.join(root,...p),run=(...args)=>git(root,args),repo={type:'git',root};
 await run('init','--object-format='+format);await run('config','core.autocrlf','false');
 const tree=(await run('mktree')).toString().trim();
 const ref=(await fs.readFile(file('.git','HEAD'),'utf8')).trim().slice(5);
 await fs.writeFile(file('body'),'tree '+tree+'\nauthor A <a@invalid> 1700000000 +0000\ncommitter C <c@invalid> 1700000000 +0000\n\npreview\n');
 const head=(await run('hash-object','-t','commit','-w','--',file('body'))).toString().trim();
 await fs.writeFile(file('.git',...ref.split('/')),head+'\n');await fs.rm(file('body'));
 return {repo,root,file,run,ref,head,tree,preview:(name='new',options={})=>prepareLightweightTagCreate(repo,{name,...options})};
}
async function state(root){
 const rows=[];async function walk(dir){for(const name of (await fs.readdir(dir)).sort()){
  const file=path.join(dir,name),s=await fs.lstat(file,{bigint:true});
  rows.push([path.relative(root,file),String(s.ino),String(s.size),String(s.mtimeNs),String(s.ctimeNs),s.isFile()?createHash('sha256').update(await fs.readFile(file)).digest('hex'):null,String(s.dev),String(s.birthtimeNs),String(s.mode)]);
  if(s.isDirectory())await walk(file);
 }}await walk(root);return rows;
}
const apply=(f,snapshot,extra={})=>applyLightweightTagCreate(f.repo,{snapshot,assertAuthorized(){},onStart(){},...extra});
const unknown=e=>e.code==='vcs/lightweight-tag-create-outcome-unknown'&&e.outcomeUnknown===true&&!Object.hasOwn(e,'appendOnly');
const absent=async f=>assert.rejects(fs.lstat(f.file('.git','refs','tags','new')),{code:'ENOENT'});
for(const format of ['sha1','sha256'])for(const logs of [false,true])test(format+' nested Unicode direct tag; only ref/log and ancestor metadata changes '+logs,async t=>{
 const f=await fixture(t,format);if(logs)await f.run('config','core.logAllRefUpdates','always');
 await fs.writeFile(f.file('.git','index'),'opaque index');await fs.writeFile(f.file('work'),'opaque work');
 const before=await state(f.root),snapshot=await f.preview('release/安全-é'),commands=[];let starts=0,auths=0;
 observe=args=>commands.push(args);
 assert.deepEqual(await apply(f,snapshot,{onStart(){starts++;},assertAuthorized(){auths++;}}),{name:snapshot.name,ref:snapshot.ref,commit:f.head,currentRef:f.ref});
 assert.equal(starts,1);assert.equal(auths,6);assert.equal(await fs.readFile(f.file('.git',...snapshot.ref.split('/')),'utf8'),f.head+'\n');
 const after=await state(f.root),allowed=['.git/'+snapshot.ref,...(logs?['.git/logs/'+snapshot.ref]:[])].map(p=>p.split('/').join(path.sep));
 const ancestor=p=>allowed.some(a=>a.startsWith(p+path.sep));
 for(const row of before){const now=after.find(r=>r[0]===row[0]);assert.ok(now);if(ancestor(row[0]))assert.deepEqual([now[0],now[1],...now.slice(5)],[row[0],row[1],...row.slice(5)]);else assert.deepEqual(now,row);}
 for(const row of after)if(!before.some(r=>r[0]===row[0]))assert.ok(allowed.includes(row[0])||ancestor(row[0]),row[0]);
 assert.equal(commands.filter(a=>a.includes('update-ref')).length,1);assert.equal(commands.filter(a=>a.includes('cat-file')&&a[a.indexOf('cat-file')+1]==='commit').length,3);
 assert.ok(commands.every(a=>!['tag','checkout','hash-object'].includes(a[0])));
 await assert.rejects(apply(f,snapshot),/consumed/);
});
test('clone rejected without consuming original; cross-repository burn is synchronous',async t=>{
 const f=await fixture(t),other=await fixture(t),snapshot=await f.preview();
 await assert.rejects(apply(f,{...snapshot}),/consumed/);
 const wrong=applyLightweightTagCreate(other.repo,{snapshot,assertAuthorized(){},onStart(){}});
 const replay=apply(f,snapshot);await assert.rejects(wrong,/mismatch/);await assert.rejects(replay,/consumed/);await absent(f);
});
for(const kind of ['extra','override','bad-auth','bad-start','missing-auth','inherited','getter','signal'])test('strict apply records burn '+kind,async t=>{
 const f=await fixture(t),snapshot=await f.preview();let gets=0;
 let options={snapshot,assertAuthorized(){},onStart(){}};
 if(kind==='extra')options.extra=true;if(kind==='override')options.ref='refs/tags/else';
 if(kind==='bad-auth')options.assertAuthorized=1;if(kind==='bad-start')options.onStart=null;
 if(kind==='missing-auth')delete options.assertAuthorized;
 if(kind==='inherited')options=Object.assign(Object.create({assertAuthorized(){}}),{snapshot,onStart(){}});
 if(kind==='getter')Object.defineProperty(options,'assertAuthorized',{get(){gets++;}});
 if(kind==='signal')options.signal={};
 await assert.rejects(applyLightweightTagCreate(f.repo,options));await assert.rejects(apply(f,snapshot),/consumed/);assert.equal(gets,0);await absent(f);
});
async function mutate(f,kind){
 if(kind==='HEAD')await fs.appendFile(f.file('.git','HEAD'),'\n');
 if(kind==='config')await fs.appendFile(f.file('.git','config'),'\n# changed\n');
 if(kind==='index')await fs.writeFile(f.file('.git','index'),'changed');
 if(kind==='namespace')await fs.mkdir(f.file('.git','refs','tags','foreign'),{recursive:true});
 if(kind==='objects')await fs.writeFile(f.file('.git','objects','foreign'),'changed');
 if(kind==='object-bytes'){const p=f.file('.git','objects',f.head.slice(0,2),f.head.slice(2));await fs.chmod(p,0o600);await fs.appendFile(p,'changed');}
 if(kind==='target'){await fs.mkdir(f.file('.git','refs','tags'),{recursive:true});await fs.writeFile(f.file('.git','refs','tags','new'),f.head+'\n');}
 if(kind==='HEADlogs'){await fs.mkdir(f.file('.git','logs'),{recursive:true});await fs.writeFile(f.file('.git','logs','HEAD'),'foreign');}
}
for(const phase of ['before','first-auth','last-auth'])for(const kind of ['HEAD','config','index','namespace','objects','object-bytes','target'])test(phase+' rejects stale '+kind,async t=>{
 const f=await fixture(t),snapshot=await f.preview();let starts=0,calls=0;
 if(phase==='before')await mutate(f,kind);
 await assert.rejects(apply(f,snapshot,{onStart(){starts++;},async assertAuthorized(){if(++calls===(phase==='last-auth'?3:1))await mutate(f,kind);}}));
 assert.equal(starts,0);if(kind!=='target')await absent(f);
});
for(const kind of ['HEAD','config','index','namespace','objects','HEADlogs','auditlog','target-recreated','missing-target','global'])test('final authorization mutation is unknown and never rolled back '+kind,async t=>{
 const f=await fixture(t);if(kind==='global'){globalConfig=f.file('global');await fs.writeFile(globalConfig,'[user]\n name = initial\n');}
 if(kind==='auditlog')await f.run('config','core.logAllRefUpdates','always');
 const snapshot=await f.preview();let calls=0,starts=0;
 await assert.rejects(apply(f,snapshot,{onStart(){starts++;},async assertAuthorized(){if(++calls!==6)return;
  if(kind==='target-recreated'){const p=f.file('.git','refs','tags','new');await fs.unlink(p);await fs.writeFile(p,f.head+'\n');}
  else if(kind==='missing-target')await fs.unlink(f.file('.git','refs','tags','new'));
  else if(kind==='global')await fs.appendFile(globalConfig,'[user]\n name = changed\n');
  else if(kind==='auditlog')await fs.appendFile(f.file('.git','logs','refs','tags','new'),'foreign');
  else await mutate(f,kind);
 }}),unknown);assert.equal(starts,1);
 if(kind!=='missing-target')assert.equal(await fs.readFile(f.file('.git','refs','tags','new'),'utf8'),f.head+'\n');
});
for(const kind of ['direct','symref'])test('onStart competing '+kind+' is not overwritten by zero-old CAS',async t=>{
 const f=await fixture(t),snapshot=await f.preview(),p=f.file('.git','refs','tags','new');let starts=0;
 const content=kind==='direct'?'1'.repeat(40)+'\n':'ref: refs/heads/missing\n';
 await assert.rejects(apply(f,snapshot,{onStart(){starts++;syncfs.writeFileSync(p,content);}}),unknown);
 assert.equal(starts,1);assert.equal(await fs.readFile(p,'utf8'),content);
});
for(const phase of ['pre','post'])test('abort '+phase+' start burns capability',async t=>{
 const f=await fixture(t),snapshot=await f.preview(),controller=new AbortController();let starts=0;
 if(phase==='pre')controller.abort();
 await assert.rejects(apply(f,snapshot,{signal:controller.signal,onStart(){starts++;controller.abort();}}),phase==='post'?unknown:undefined);
 assert.equal(starts,phase==='pre'?0:1);await assert.rejects(apply(f,snapshot),/consumed/);
});
test('thenable onStart is rejected as outcome unknown',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let starts=0;
 await assert.rejects(apply(f,snapshot,{onStart(){starts++;return Promise.resolve();}}),unknown);assert.equal(starts,1);await absent(f);
});
test('pending authorization respects inherited deadline and burns without write',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let starts=0;
 await assert.rejects(withOperationBudget({timeoutMs:1200},()=>apply(f,snapshot,{assertAuthorized(){return new Promise(()=>{});},onStart(){starts++;}})),{code:'TIMEOUT'});
 assert.equal(starts,0);await absent(f);await assert.rejects(apply(f,snapshot),/consumed/);
});
for(const turn of [1,3])test('effective global configuration change at authorization '+turn+' fails before start',async t=>{
 const f=await fixture(t);globalConfig=f.file('global');await fs.writeFile(globalConfig,'[user]\n name = initial\n');
 const snapshot=await f.preview();let calls=0,starts=0;
 await assert.rejects(apply(f,snapshot,{onStart(){starts++;},async assertAuthorized(){if(++calls===turn)await fs.appendFile(globalConfig,'[user]\n name = changed\n');}}),/Effective Git configuration changed/);
 assert.equal(starts,0);await absent(f);
});
test('final authorization denial retains created ref as unknown',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let calls=0;
 await assert.rejects(apply(f,snapshot,{assertAuthorized(){if(++calls===6)throw new Error('permission revoked');}}),unknown);
 assert.equal(await fs.readFile(f.file('.git','refs','tags','new'),'utf8'),f.head+'\n');
});
test('existing target rejects preview',async t=>{const f=await fixture(t);await fs.mkdir(f.file('.git','refs','tags'),{recursive:true});await fs.writeFile(f.file('.git','refs','tags','new'),f.head+'\n');await assert.rejects(f.preview(),/collision/);});
