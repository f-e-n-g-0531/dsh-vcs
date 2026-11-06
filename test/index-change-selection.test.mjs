import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {git} from '../local-command.mjs';
import {listChanges,prepareSelectedIndexUnstage,applyIndexUnstage} from '../vcs.mjs';
const originalSpawn=cp.spawn;
const commands=[];
cp.spawn=(command,args,options)=>{commands.push(args);return originalSpawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-index-selection-absent-global-config')}});};
syncBuiltinESMExports();
test.after(()=>{cp.spawn=originalSpawn;syncBuiltinESMExports();});
async function fixture(t){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-index-selection-')));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const run=(...args)=>git(root,args),write=(p,text)=>fs.writeFile(path.join(root,p),text);
 await run('init');for(const [key,value]of [['user.name','Selection Test'],['user.email','test@example.invalid'],['core.autocrlf','false'],['commit.gpgsign','false']])await run('config',key,value);
 await write('selected.txt','base\n');await write('work.txt','work base\n');await run('add','.');await run('commit','-m','base');await write('selected.txt','staged\n');await run('add','selected.txt');await write('work.txt','unstaged\n');await write('new.txt','untracked\n');
 const repo={type:'git',root},staged=await listChanges(repo,'staged');return {root,repo,run,write,id:staged.find(e=>e.path==='selected.txt').id,index:()=>fs.readFile(path.join(root,'.git','index'))};
}
test('public adapter resolves the exact existing staged ID and applies its private snapshot',async t=>{
 const f=await fixture(t),before=await f.index(),work=await fs.readFile(path.join(f.root,'selected.txt'));
 const snapshot=await prepareSelectedIndexUnstage(f.repo,{id:f.id});assert.equal(snapshot.path,'selected.txt');assert.deepEqual(await f.index(),before);
 let starts=0;await applyIndexUnstage(f.repo,{snapshot,assertAuthorized:()=>{},onStart:()=>starts++});assert.equal(starts,1);assert.deepEqual(await fs.readFile(path.join(f.root,'selected.txt')),work);assert.equal((await listChanges(f.repo,'staged')).length,0);
});
test('all-mode, unstaged, unknown and path-shaped selections cannot become staged addresses',async t=>{
 const f=await fixture(t),before=await f.index(),all=await listChanges(f.repo,'all'),unstaged=await listChanges(f.repo,'unstaged');
 for(const id of [all.find(e=>e.path==='selected.txt').id,unstaged.find(e=>e.path==='work.txt').id,'f'.repeat(64),'selected.txt','../selected.txt','',null])await assert.rejects(prepareSelectedIndexUnstage(f.repo,{id}));assert.deepEqual(await f.index(),before);
});
test('staged identity changes invalidate a previously displayed ID',async t=>{
 const f=await fixture(t);await f.write('selected.txt','mixed staged plus unstaged\n');const before=await f.index();await assert.rejects(prepareSelectedIndexUnstage(f.repo,{id:f.id}));assert.deepEqual(await f.index(),before);
});
test('guarded capture rejects executable config and active metadata before any ordinary status',async t=>{
 const f=await fixture(t);for(const state of ['filter','hook','lock']){
  if(state==='filter')await f.run('config','filter.untrusted.clean','echo forbidden');
  if(state==='hook')await fs.writeFile(path.join(f.root,'.git','hooks','post-index-change'),'echo forbidden');
  if(state==='lock')await fs.writeFile(path.join(f.root,'.git','index.lock'),'foreign');
  const from=commands.length;await assert.rejects(prepareSelectedIndexUnstage(f.repo,{id:f.id}),undefined,state);assert.equal(commands.slice(from).some(args=>args.includes('status')),false,state+' must be rejected before status');
  if(state==='filter')await f.run('config','--remove-section','filter.untrusted');
  if(state==='hook')await fs.unlink(path.join(f.root,'.git','hooks','post-index-change'));
  if(state==='lock')await fs.unlink(path.join(f.root,'.git','index.lock'));
 }
});
test('cancelled selector captures do not return a snapshot or modify the index',async t=>{
 const f=await fixture(t),before=await f.index(),c=new AbortController();c.abort();await assert.rejects(prepareSelectedIndexUnstage(f.repo,{id:f.id,signal:c.signal}));assert.deepEqual(await f.index(),before);
});
