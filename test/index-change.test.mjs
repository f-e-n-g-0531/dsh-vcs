import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {git} from '../local-command.mjs';
import {parseGitIndex} from '../src/git-index.mjs';
import {prepareIndexUnstage,applyIndexUnstage} from '../index-change.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';

// Isolate only test child processes from the developer's system/global Git config.
const originalSpawn=cp.spawn;
cp.spawn=(command,args,options)=>originalSpawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-index-change-absent-global-config')}});
syncBuiltinESMExports();
test.after(()=>{cp.spawn=originalSpawn;syncBuiltinESMExports();});

async function fixture(t,format='sha1',born=true){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-index-change-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
  const run=(...args)=>git(root,args);
  await run('init','--object-format='+format);
  for(const [key,value] of [['user.name','Index Test'],['user.email','test@example.invalid'],['core.autocrlf','false'],['core.safecrlf','false'],['core.hooksPath','false'],['core.attributesFile','false'],['commit.gpgsign','false']])await run('config',key,value);
  // Remove these keys rather than shadowing their paths: adapter refuses configured paths.
  await run('config','--unset','core.hooksPath');await run('config','--unset','core.attributesFile');
  const write=(file,text)=>fs.writeFile(path.join(root,file),text);
  await write('selected.txt','base\n');await write('staged.txt','stage base\n');await write('unstaged.txt','work base\n');
  await run('add','.');if(born)await run('commit','-m','base');
  await write('selected.txt','selected staged\n');await write('staged.txt','other staged\n');await run('add','selected.txt','staged.txt');
  await write('staged.txt','other staged AND unstaged\n');await write('unstaged.txt','other unstaged\n');await write('untracked.txt','untracked\n');
  const repo={type:'git',root};const index=()=>fs.readFile(path.join(root,'.git','index'));
  const prepare=()=>prepareIndexUnstage(repo,{path:'selected.txt'});
  return {root,repo,run,write,index,prepare,format};
}
const hooks={assertAuthorized:()=>{},onStart:()=>{}};
const apply=(f,snapshot,extra={})=>applyIndexUnstage(f.repo,{snapshot,...hooks,...extra});
const unknown=e=>e.code==='vcs/index-outcome-unknown'&&e.outcomeUnknown===true;

for(const format of ['sha1','sha256'])test('unstage selected only, preserve unrelated MM and untracked: '+format,async t=>{
  const f=await fixture(t,format);const before=await f.index();
  const entries=parseGitIndex(before,{objectFormat:format}).entries;
  const work=await Promise.all(['selected.txt','staged.txt','unstaged.txt','untracked.txt'].map(p=>fs.readFile(path.join(f.root,p))));
  const snapshot=await f.prepare();assert.ok(Object.isFrozen(snapshot));assert.deepEqual(await f.index(),before);
  let starts=0;const result=await apply(f,snapshot,{onStart:()=>{starts++;}});
  assert.equal(starts,1);assert.equal(result.path,'selected.txt');assert.equal(result.index.oid,(await f.run('rev-parse','HEAD:selected.txt')).toString().trim());
  const after=parseGitIndex(await f.index(),{objectFormat:format}).entries;
  assert.deepEqual(after.filter(e=>e.path!=='selected.txt'),entries.filter(e=>e.path!=='selected.txt'));
  for(let i=0;i<work.length;i++)assert.deepEqual(await fs.readFile(path.join(f.root,['selected.txt','staged.txt','unstaged.txt','untracked.txt'][i])),work[i]);
  assert.equal((await f.run('diff','--cached','--name-only')).toString().trim(),'staged.txt');
  assert.match((await f.run('status','--porcelain')).toString(),/ M selected.txt/);
  await assert.rejects(fs.lstat(path.join(f.root,'.git','index.lock')),{code:'ENOENT'});
});

for(const change of ['selected work','unrelated work','index','head','index identity'])test('reject stale '+change+' without start',async t=>{
  const f=await fixture(t),snapshot=await f.prepare();
  if(change==='selected work')await f.write('selected.txt','changed');
  if(change==='unrelated work')await f.write('unstaged.txt','changed');
  if(change==='index'){await f.write('untracked.txt','stage now');await f.run('add','untracked.txt');}
  if(change==='head')await f.run('commit','--allow-empty','-m','advance');
  if(change==='index identity'){const p=path.join(f.root,'.git','index');await fs.rename(p,p+'.old');await fs.copyFile(p+'.old',p);await fs.unlink(p+'.old');}
  const before=await f.index();let start=false;
  await assert.rejects(apply(f,snapshot,{onStart:()=>{start=true;}}));assert.equal(start,false);assert.deepEqual(await f.index(),before);
});

test('caller clones and unsafe exact paths are not accepted',async t=>{
  const f=await fixture(t),snapshot=await f.prepare();
  await assert.rejects(apply(f,{...snapshot}),{code:'vcs/index-stale'});
  for(const p of ['../selected.txt','/selected.txt','selected.txt:stream','.git/config','a\\b','SELECTED.txt','selected.txt '])await assert.rejects(prepareIndexUnstage(f.repo,{path:p}));
});

test('existing locks remain untouched, including on apply',async t=>{
  const f=await fixture(t),snapshot=await f.prepare(),lock=path.join(f.root,'.git','index.lock');await fs.writeFile(lock,'foreign lock');const stat=await fs.lstat(lock,{bigint:true});
  await assert.rejects(f.prepare());await assert.rejects(apply(f,snapshot));assert.equal(await fs.readFile(lock,'utf8'),'foreign lock');assert.equal((await fs.lstat(lock,{bigint:true})).ino,stat.ino);
});

for(const state of ['MM','attributes','tracked attributes','filter','hooks','operation','sparse','partial','assume','skip','hardlink','index hardlink','active hook','large','submodule'])test('refuse unsupported '+state,async t=>{
  const f=await fixture(t);const before=await f.index();
  if(state==='MM')await f.write('selected.txt','unstaged after staging');
  if(state==='attributes')await f.write('.gitattributes','* filter=evil');
  if(state==='tracked attributes'){await f.write('.gitattributes','* text');await f.run('add','.gitattributes');await fs.unlink(path.join(f.root,'.gitattributes'));}
  if(state==='filter')await f.run('config','filter.evil.clean','echo unsafe');
  if(state==='hooks')await f.run('config','core.hooksPath','evil');
  if(state==='operation')await fs.writeFile(path.join(f.root,'.git','MERGE_HEAD'),'bad');
  if(state==='sparse')await f.run('config','core.sparseCheckout','true');
  if(state==='partial')await f.run('config','remote.origin.promisor','true');
  if(state==='assume')await f.run('update-index','--assume-unchanged','staged.txt');
  if(state==='skip')await f.run('update-index','--skip-worktree','staged.txt');
  if(state==='hardlink')await fs.link(path.join(f.root,'selected.txt'),path.join(f.root,'alias'));
  if(state==='index hardlink')await fs.link(path.join(f.root,'.git','index'),path.join(f.root,'.git','alias'));
  if(state==='active hook')await fs.writeFile(path.join(f.root,'.git','hooks','post-index-change'),'echo unsafe');
  if(state==='large')await f.write('untracked.txt',Buffer.alloc(2*1024*1024+1));
  if(state==='submodule'){const head=(await f.run('rev-parse','HEAD')).toString().trim();await f.run('update-index','--add','--cacheinfo','160000,'+head+',module');}
  const live=await f.index();await assert.rejects(f.prepare());assert.deepEqual(await f.index(),live);assert.ok(before.length);
});

test('refuse symlink when supported',async t=>{
  const f=await fixture(t);try{await fs.symlink(path.join(f.root,'selected.txt'),path.join(f.root,'alias'));}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code)){t.skip('symlink creation unavailable: '+e.code);return;}throw e;}
  await assert.rejects(f.prepare());
});

test('unborn and detached HEAD refused',async t=>{
  const unborn=await fixture(t,'sha1',false);await assert.rejects(unborn.prepare());
  const detached=await fixture(t);await detached.run('checkout','--detach');await assert.rejects(detached.prepare());
});

test('cancellation and authorization before publication preserve index',async t=>{
  const f=await fixture(t),snapshot=await f.prepare(),before=await f.index();let started=false;
  const controller=new AbortController();controller.abort();
  await assert.rejects(apply(f,snapshot,{signal:controller.signal,onStart:()=>{started=true;}}));
  await assert.rejects(apply(f,snapshot,{assertAuthorized:()=>{throw Error('denied');},onStart:()=>{started=true;}}),/denied/);
  let calls=0;await assert.rejects(apply(f,snapshot,{assertAuthorized:()=>{if(++calls===3)throw Error('revoked');},onStart:()=>{started=true;}}),/revoked/);
  assert.equal(started,false);assert.deepEqual(await f.index(),before);
});

for(const mutationCall of [2,3])test('authorization mutation under lock revalidates snapshot, call '+mutationCall,async t=>{
  const f=await fixture(t),snapshot=await f.prepare(),before=await f.index();let calls=0,started=false;
  await assert.rejects(apply(f,snapshot,{assertAuthorized:async()=>{if(++calls===mutationCall)await f.write('unstaged.txt','race');},onStart:()=>{started=true;}}));assert.equal(started,false);assert.deepEqual(await f.index(),before);
});

test('onStart failures or abort are outcome unknown even before rename',async t=>{
  const f=await fixture(t),snapshot=await f.prepare(),before=await f.index();
  await assert.rejects(apply(f,snapshot,{onStart:()=>{throw Error('start notification');}}),unknown);assert.deepEqual(await f.index(),before);
  const c=new AbortController();await assert.rejects(apply(f,snapshot,{signal:c.signal,onStart:()=>c.abort()}),unknown);assert.deepEqual(await f.index(),before);
});

for(const kind of ['authorization','cancellation','deadline','work mutation'])test('post publication '+kind+' is outcome unknown',async t=>{
  const f=await fixture(t),snapshot=await f.prepare(),before=await f.index(),c=new AbortController();let started=false;
  const operation=()=>apply(f,snapshot,{signal:c.signal,onStart:()=>{started=true;},assertAuthorized:async()=>{if(!started)return;if(kind==='authorization')throw Error('revoked');if(kind==='cancellation')c.abort();if(kind==='deadline')await new Promise(resolve=>setTimeout(resolve,350));if(kind==='work mutation')await f.write('unstaged.txt','raced');}});
  if(kind==='deadline')await assert.rejects(withOperationBudget({timeoutMs:8000},async()=>{ // consume almost all budget only once publication has occurred
    return apply(f,snapshot,{onStart:()=>{started=true;},assertAuthorized:async()=>{if(started)await new Promise(resolve=>setTimeout(resolve,8100));}});
  }),unknown);else await assert.rejects(operation(),unknown);
  assert.equal(started,true);assert.notDeepEqual(await f.index(),before);assert.equal((await f.run('rev-parse',':selected.txt')).toString().trim(),(await f.run('rev-parse','HEAD:selected.txt')).toString().trim());
});
