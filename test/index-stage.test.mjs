import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {writeFileSync,readFileSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {syncBuiltinESMExports} from 'node:module';
import {git} from '../local-command.mjs';
import {parseGitIndex} from '../src/git-index.mjs';
import {listChanges} from '../vcs.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
import {prepareIndexStage,prepareSelectedIndexStage,applyIndexStage,prepareIndexUnstage,applyIndexUnstage} from '../index-change.mjs';
const originalSpawn=cp.spawn;
cp.spawn=(command,args,options)=>originalSpawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-index-stage-absent-global-config')}});
syncBuiltinESMExports();
test.after(()=>{cp.spawn=originalSpawn;syncBuiltinESMExports();});
const raw=Buffer.from([0,255,13,10,65,13,10,66]);
const hooks={assertAuthorized:()=>{},onStart:()=>{}};
const unknown=e=>e.code==='vcs/index-outcome-unknown'&&e.outcomeUnknown&&e.appendOnly;
async function fixture(t,format='sha1',bytes=raw){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-index-stage-')));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const run=(...args)=>git(root,args),write=(p,b)=>fs.writeFile(path.join(root,p),b);
 await run('init','--object-format='+format);
 for(const [key,value]of [['user.name','Stage Test'],['user.email','test@example.invalid'],['core.autocrlf','false'],['core.safecrlf','false'],['commit.gpgsign','false']])await run('config',key,value);
 await write('selected.txt','base\n');await write('other.txt','other base\n');await run('add','.');await run('commit','-m','base');
 await write('other.txt','other staged\n');await run('add','other.txt');await write('other.txt','other MM\n');await write('selected.txt',bytes);await write('untracked.txt','untracked');
 const repo={type:'git',root},index=()=>fs.readFile(path.join(root,'.git','index')),prepare=()=>prepareIndexStage(repo,{path:'selected.txt'});
 return {root,run,write,repo,index,prepare,format,bytes};
}
const apply=(f,snapshot,extra={})=>applyIndexStage(f.repo,{snapshot,...hooks,...extra});
const objectPath=(f,s)=>path.join(f.root,'.git','objects',s.target.oid.slice(0,2),s.target.oid.slice(2));
for(const format of ['sha1','sha256'])for(const [label,bytes]of [['binary CRLF',raw],['CRLF no final newline',Buffer.from('one\r\ntwo')]])test('stage exact raw '+label+' '+format,async t=>{
 const f=await fixture(t,format,bytes),before=await f.index(),entries=parseGitIndex(before,{objectFormat:format}).entries;
 const head=await f.run('rev-parse','HEAD'),config=await fs.readFile(path.join(f.root,'.git','config'));
 const snapshot=await f.prepare();assert.ok(Object.isFrozen(snapshot)&&Object.isFrozen(snapshot.target)&&Object.isFrozen(snapshot.index));
 assert.deepEqual(Object.keys(snapshot),['path','head','index','target','fingerprint']);assert.equal(snapshot.target.oid,createHash(format).update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'));
 assert.deepEqual(await f.index(),before);let starts=0;
 await apply(f,snapshot,{onStart:()=>{starts++;assert.equal(existsSync(objectPath(f,snapshot)),false);}});assert.equal(starts,1);
 assert.deepEqual(await f.run('cat-file','blob',snapshot.target.oid),bytes);assert.deepEqual(await fs.readFile(path.join(f.root,'selected.txt')),bytes);
 const after=parseGitIndex(await f.index(),{objectFormat:format}).entries;
 assert.deepEqual(after.filter(e=>e.path!=='selected.txt'),entries.filter(e=>e.path!=='selected.txt'));
 assert.equal(after.find(e=>e.path==='selected.txt').oid,snapshot.target.oid);
 assert.deepEqual(await f.run('rev-parse','HEAD'),head);assert.deepEqual(await fs.readFile(path.join(f.root,'.git','config')),config);
 assert.equal(await fs.readFile(path.join(f.root,'other.txt'),'utf8'),'other MM\n');assert.match((await f.run('status','--porcelain')).toString(),/MM other.txt/);
 await assert.rejects(apply(f,snapshot));await assert.rejects(fs.lstat(path.join(f.root,'.git','index.lock')),{code:'ENOENT'});
});
test('exact existing unstaged identity only; selected MM refused',async t=>{
 const f=await fixture(t),changes=await listChanges(f.repo,'unstaged'),id=changes.find(e=>e.path==='selected.txt').id;
 const s=await prepareSelectedIndexStage(f.repo,{id});assert.equal(s.path,'selected.txt');
 for(const bad of [(await listChanges(f.repo,'all')).find(e=>e.path==='selected.txt').id,'f'.repeat(64),'selected.txt',changes.find(e=>e.path==='other.txt').id])await assert.rejects(prepareSelectedIndexStage(f.repo,{id:bad}));
 await assert.rejects(prepareIndexStage(f.repo,{path:'other.txt'}));await apply(f,s);
});
for(const mutation of ['work','unrelated work','index','head','config','metadata object'])test('stale '+mutation+' refuses before start',async t=>{
 const f=await fixture(t),s=await f.prepare();
 if(mutation==='work')await f.write('selected.txt','different');
 if(mutation==='unrelated work')await f.write('untracked.txt','different');
 if(mutation==='index')await f.run('add','untracked.txt');
 if(mutation==='head')await f.run('commit','--allow-empty','-m','advance');
 if(mutation==='config')await f.run('config','test.changed','yes');
 if(mutation==='metadata object')await fs.writeFile(path.join(f.root,'.git','objects','info','foreign'),'foreign');
 const before=await f.index();let starts=0;await assert.rejects(apply(f,s,{onStart:()=>starts++}));assert.equal(starts,0);assert.deepEqual(await f.index(),before);assert.equal(existsSync(objectPath(f,s)),false);
});
test('clones and stage/unstage snapshot cross-use refused',async t=>{
 const f=await fixture(t),s=await f.prepare(),u=await prepareIndexUnstage(f.repo,{path:'other.txt'}).catch(()=>null);
 // Other is MM; obtain a legitimate unstage snapshot without changing its Index.
 await f.write('other.txt','other staged\n');const unstaged=await prepareIndexUnstage(f.repo,{path:'other.txt'});
 await assert.rejects(apply(f,{...s}),{code:'vcs/index-stale'});await assert.rejects(apply(f,unstaged),{code:'vcs/index-stale'});
 await assert.rejects(applyIndexUnstage(f.repo,{snapshot:s,...hooks}),{code:'vcs/index-stale'});assert.equal(u,null);
});
for(const state of ['add','delete','rename','autocrlf','attributes','filter','hook','special'])test('stage refuses '+state,async t=>{
 const f=await fixture(t);let selected='selected.txt';
 if(state==='add'){selected='untracked.txt';await f.run('add',selected);}
 if(state==='delete')await fs.unlink(path.join(f.root,selected));
 if(state==='rename'){await f.run('mv',selected,'renamed.txt');selected='renamed.txt';}
 if(state==='autocrlf')await f.run('config','core.autocrlf','true');
 if(state==='attributes')await f.write('.gitattributes','* text');
 if(state==='filter')await f.run('config','filter.bad.clean','echo bad');
 if(state==='hook')await fs.writeFile(path.join(f.root,'.git','hooks','post-index-change'),'bad');
 if(state==='special')await f.run('update-index','--skip-worktree',selected);
 const before=await f.index();await assert.rejects(prepareIndexStage(f.repo,{path:selected}));assert.deepEqual(await f.index(),before);
});
for(const phase of ['auth before','cancel before','auth after','cancel after'])test(phase+' staging boundary',async t=>{
 const f=await fixture(t),s=await f.prepare(),before=await f.index(),c=new AbortController();let started=false;
 if(phase==='cancel before')c.abort();
 const assertAuthorized=()=>{if(phase==='auth before'||phase==='auth after'&&started)throw new Error('denied');};
 await assert.rejects(apply(f,s,{signal:c.signal,assertAuthorized,onStart:()=>{started=true;if(phase==='cancel after')c.abort();}}),phase.endsWith('after')?unknown:undefined);
 assert.equal(started,phase.endsWith('after'));assert.deepEqual(await f.index(),before);
});
test('pre-existing correct target blob is reused; start still precedes Index publication',async t=>{
 const f=await fixture(t);await f.run('hash-object','-w','--no-filters','selected.txt');const s=await f.prepare(),before=await f.index();let starts=0;
 await apply(f,s,{onStart:()=>{starts++;assert.ok(existsSync(objectPath(f,s)));assert.deepEqual(requireIndex(),before);}});
 function requireIndex(){return readFileSync(path.join(f.root,'.git','index'));}
 assert.equal(starts,1);
});
for(const mutation of ['work','foreign new object','foreign existing object','index'])test('append remains after failed CAS: '+mutation,async t=>{
 const f=await fixture(t),s=await f.prepare(),before=await f.index();let started=false,changed=false;
 const headOid=(await f.run('rev-parse','HEAD:selected.txt')).toString().trim(),foreign=path.join(f.root,'.git','objects',headOid.slice(0,2),headOid.slice(2));
 await assert.rejects(apply(f,s,{onStart:()=>{started=true;},assertAuthorized:()=>{
  if(!started||changed||!existsSync(objectPath(f,s)))return;changed=true;
  if(mutation==='work')writeFileSync(path.join(f.root,'selected.txt'),'late work');
  if(mutation==='foreign new object')writeFileSync(path.join(path.dirname(objectPath(f,s)), 'f'.repeat(s.target.oid.length-2)),deflateSync(Buffer.from('blob 7\0foreign')));
  if(mutation==='foreign existing object')writeFileSync(foreign,'foreign overwrite');
  if(mutation==='index')writeFileSync(path.join(f.root,'.git','index'),Buffer.from(before));
 }}),unknown);
 assert.ok(changed);assert.ok(existsSync(objectPath(f,s)));assert.deepEqual(await f.run('cat-file','blob',s.target.oid),f.bytes);assert.deepEqual(await f.index(),before);
});
for(const phase of ['before','after'])test('ambient cancellation '+phase+' start',async t=>{
 const f=await fixture(t),s=await f.prepare(),c=new AbortController();let started=false;
 if(phase==='before')c.abort();
 await assert.rejects(withOperationBudget({signal:c.signal},()=>apply(f,s,{onStart:()=>{started=true;c.abort();}})),phase==='after'?unknown:undefined);
 assert.equal(started,phase==='after');
});
test('existing object start callback mutations cannot pass final state validation',async t=>{
 const f=await fixture(t);await f.run('hash-object','-w','--no-filters','selected.txt');const s=await f.prepare(),before=await f.index();
 await assert.rejects(apply(f,s,{onStart:()=>writeFileSync(path.join(f.root,'selected.txt'),'mutated')}),unknown);
 assert.deepEqual(await f.index(),before);assert.ok(existsSync(objectPath(f,s)));
});
