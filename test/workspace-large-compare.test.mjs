import test from 'node:test';import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {gitCommand} from './helpers/git-command.mjs';
import {detectRepository,listChanges,getComparison} from '../vcs.mjs';
import {createHandler} from '../index.mjs';
test('workspace large RPC strictly validates mode and shares heavy slot until cancellation settles',async()=>{
 let finish,entered;const started=new Promise(resolve=>entered=resolve);let signal;
 const call=createHandler({sessions:{get:()=>({header:{cwd:'/workspace'}})}},{discoverRepositories:async()=>({repositories:[{id:'r',root:'/workspace',type:'git'}],warnings:[]}),getComparison:async(_repo,opts)=>{signal=opts.signal;entered();return new Promise(resolve=>finish=resolve);},getHistoricalSegment:async()=>({}),listHistory:async()=>({})});
 const p={sessionId:'s',repositoryId:'r',mode:'all',id:'b'.repeat(64),large:true};
 assert.equal((await call('vcs/compare',p)).error.code,'vcs/rediscover-required');await call('vcs/repositories',{sessionId:'s'});
 for(const large of [null,1,'true',{},[]])assert.equal((await call('vcs/compare',{...p,large})).error.code,'vcs/invalid-request');
 const c=new AbortController();const request=call('vcs/compare',p,c.signal);await started;assert.equal(signal,c.signal);
 assert.equal((await call('vcs/tree-segment',{sessionId:'s',repositoryId:'r',commit:'a'.repeat(40),path:'file'})).error.code,'vcs/busy');assert.equal((await call('vcs/history',{sessionId:'s',repositoryId:'r'})).ok,true);
 c.abort();finish({});assert.equal((await request).error.code,'vcs/cancelled');assert.equal((await call('vcs/tree-segment',{sessionId:'s',repositoryId:'r',commit:'a'.repeat(40),path:'file'})).ok,true);
});

test('large workspace modes bind HEAD Index and working complete content without writes',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'vcs-large-modes-'))),git=gitCommand(root);
 try{
  git('init','-q');git('config','user.name','Test');git('config','user.email','t@example.test');git('config','core.autocrlf','false');
  const before=('base '+ 'x'.repeat(110)+'\n').repeat(24000),staged='INDEX\n'+before,working=staged+'EOF WORKING\n';
  const file=path.join(root,'file.txt');await fs.writeFile(file,before);git('add','.');git('commit','-qm','base');await fs.writeFile(file,staged);git('add','.');await fs.writeFile(file,working);
  const repo=await detectRepository(root),index=git('ls-files','--stage'),status=git('status','--porcelain');
  for(const mode of ['all','staged','unstaged']){
   const entry=(await listChanges(repo,mode))[0];const diff=await getComparison(repo,{mode,id:entry.id,large:true});assert.equal(diff.left.text,mode==='unstaged'?staged:before);assert.equal(diff.right.text,mode==='staged'?staged:working);assert.equal(diff.large,true);
  }
  assert.equal(git('ls-files','--stage'),index);assert.equal(git('status','--porcelain'),status);assert.equal(await fs.readFile(file,'utf8'),working);
  await fs.writeFile(path.join(root,'untracked.txt'),working);const untracked=(await listChanges(repo)).find(row=>row.path==='untracked.txt');const newFile=await getComparison(repo,{id:untracked.id,large:true});assert.equal(newFile.left.text,'');assert.equal(newFile.right.text,working);
  git('add','untracked.txt');const added=(await listChanges(repo,'staged')).find(row=>row.path==='untracked.txt');assert.equal((await getComparison(repo,{mode:'staged',id:added.id,large:true})).right.text,working);
  await fs.rm(file);const removed=(await listChanges(repo,'unstaged')).find(row=>row.path==='file.txt');const deletion=await getComparison(repo,{mode:'unstaged',id:removed.id,large:true});assert.equal(deletion.left.text,staged);assert.equal(deletion.right.text,'');
  const id=(await listChanges(repo))[0].id;await assert.rejects(getComparison(repo,{id,large:'yes'}),/mode/);
  const c=new AbortController();c.abort();await assert.rejects(getComparison(repo,{id,large:true,signal:c.signal}));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
