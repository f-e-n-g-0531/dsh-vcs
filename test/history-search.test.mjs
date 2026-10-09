import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {buildHistoryGraph} from '../src/history-graph.mjs';
import {assignGraphLanes} from '../src/graph-lanes.mjs';
import {listReferences,listHistory,detectRepository} from '../vcs.mjs';
test('local branch snapshots include branch-only commits and merge lanes without workspace mutations',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-branch-')),git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
 try{
  git('init','-q','-b','main');git('config','user.name','Branches');git('config','user.email','branch@example.test');
  await writeFile(path.join(root,'root.txt'),'root');git('add','.');git('commit','-q','-m','root');git('checkout','-q','-b','topic');
  await writeFile(path.join(root,'topic.txt'),'topic');git('add','.');git('commit','-q','-m','topic-only');git('checkout','-q','main');
  await writeFile(path.join(root,'main.txt'),'main');git('add','.');git('commit','-q','-m','main-only');
  const repo=await detectRepository(root),ref=(await listReferences(repo)).references.find(r=>r.name==='refs/heads/topic');
  const before=git('status','--porcelain'),branch=git('symbolic-ref','HEAD');
  const page=await listHistory(repo,{snapshot:ref.commit,limit:1});assert.equal(page.commits[0].subject,'topic-only');
  assert.equal((await listHistory(repo)).commits.some(c=>c.subject==='topic-only'),false);
  git('branch','-f','topic','main');
  const next=await listHistory(repo,{snapshot:page.snapshot,offset:1,limit:1});assert.equal(next.commits[0].subject,'root');assert.equal(next.nextOffset,null);
  assert.equal((await listHistory(repo,{snapshot:ref.commit,search:{message:'topic-only'}})).commits.length,1);
  git('branch','-f','topic',ref.commit);git('merge','--no-ff','-q','topic','-m','merge');
  const history=await listHistory(repo),graph=buildHistoryGraph(history.commits),lanes=assignGraphLanes(graph);
  assert.equal(history.commits[0].parents.length,2);assert.equal(lanes.laneCount,2);assert.equal(lanes.edges.length,4);
  assert.equal(git('status','--porcelain'),before);assert.equal(git('symbolic-ref','HEAD'),branch);
 }finally{await rm(root,{recursive:true,force:true});}
});
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
