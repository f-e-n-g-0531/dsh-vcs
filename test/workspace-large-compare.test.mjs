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

test('workspace large handles unborn additions and rename but rejects unmerged Index',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'vcs-large-special-'))),git=gitCommand(root);
 try{
  git('init','-q');git('config','user.name','Test');git('config','user.email','t@example.test');git('config','core.autocrlf','false');
  const text=('base '+ 'x'.repeat(110)+'\n').repeat(24000);await fs.writeFile(path.join(root,'old.txt'),text);git('add','.');let repo=await detectRepository(root);
  const added=(await listChanges(repo,'staged'))[0];const unborn=await getComparison(repo,{mode:'staged',id:added.id,large:true});assert.equal(unborn.left.text,'');assert.equal(unborn.right.text,text);
  git('commit','-qm','root');git('mv','old.txt','new.txt');const renamed=(await listChanges(repo,'staged'))[0];const diff=await getComparison(repo,{mode:'staged',id:renamed.id,large:true});assert.equal(diff.left.text,text);assert.equal(diff.right.text,text);assert.equal(diff.oldPath,'old.txt');
  git('commit','-qm','rename');const branch=git('branch','--show-current').trim();git('checkout','-qb','topic');await fs.writeFile(path.join(root,'new.txt'),'topic');git('add','.');git('commit','-qm','topic');git('checkout','-q',branch);await fs.writeFile(path.join(root,'new.txt'),'main');git('add','.');git('commit','-qm','main');
  try{git('merge','topic');}catch{}
  const conflict=(await listChanges(repo)).find(row=>row.status==='conflicted');assert.ok(conflict);await assert.rejects(getComparison(repo,{id:conflict.id,large:true}),/conflicted/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
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
  git('rm','-f','untracked.txt');git('rm','-f','file.txt');const stagedDelete=(await listChanges(repo)).find(row=>row.path==='file.txt');const allDelete=await getComparison(repo,{id:stagedDelete.id,large:true});assert.equal(allDelete.left.text,before);assert.equal(allDelete.right.text,'');
  git('reset','--hard','HEAD');git('rm','--cached','file.txt');const cachedRemoved=(await listChanges(repo)).find(row=>row.path==='file.txt'&&row.indexStatus==='D');const retained=await getComparison(repo,{id:cachedRemoved.id,large:true});assert.equal(retained.right.text,before);
  const id=(await listChanges(repo))[0].id;await assert.rejects(getComparison(repo,{id,large:'yes'}),/mode/);
  const c=new AbortController();c.abort();await assert.rejects(getComparison(repo,{id,large:true,signal:c.signal}));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
