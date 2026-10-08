import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {listHistory,detectRepository} from '../vcs.mjs';
test('server history search matches full messages literal paths and paginates a pinned snapshot',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-search-'));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
 try{
  git('init','-q');git('config','user.name','Search Author');git('config','user.email','search@example.test');
  for(let i=0;i<4;i++){await writeFile(path.join(root,'literal[1].txt'),String(i));git('add','--','literal[1].txt');git('commit','-q','-m','subject '+i,'-m',i%2?'Body NEEDLE .*':'other');}
  const repo=await detectRepository(root),first=await listHistory(repo,{search:{message:'needle .*',author:'search author',path:'literal[1].txt'},limit:1});
  assert.equal(first.commits.length,1);assert.equal(first.commits[0].subject,'subject 3');assert.equal(first.nextOffset,1);
  await writeFile(path.join(root,'literal[1].txt'),'later');git('add','.');git('commit','-q','-m','later needle .*');
  const next=await listHistory(repo,{snapshot:first.snapshot,search:{message:'needle .*',author:'search author',path:'literal[1].txt'},offset:1,limit:1});
  assert.equal(next.commits[0].subject,'subject 1');assert.equal(next.nextOffset,null);
  assert.equal((await listHistory(repo,{search:{message:'needle .+'}})).commits.length,0);
  assert.equal((await listHistory(repo,{search:{path:'literal*.txt'}})).commits.length,0);
  await assert.rejects(listHistory(repo,{search:{path:'../escape'}}));
 }finally{await rm(root,{recursive:true,force:true});}
});
