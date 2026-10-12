import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {detectRepository,listStashes,getCommitDetails} from '../vcs.mjs';
const g=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
test('stash list is read-only, bounded, and reuses commit details for its diff',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vcs-stash-'));
 try{
  g(root,'init','-q');g(root,'config','user.name','T');g(root,'config','user.email','t@example.test');
  await writeFile(path.join(root,'f'),'base\n');g(root,'add','.');g(root,'commit','-q','-m','base');
  await writeFile(path.join(root,'f'),'stashed\n');g(root,'stash','push','-q','-m','wip stash');
  const repo=await detectRepository(root),before=g(root,'rev-parse','refs/stash').trim();
  const {stashes}=await listStashes(repo);
  assert.equal(stashes.length,1);assert.equal(stashes[0].ref,'stash@{0}');assert.match(stashes[0].message,/wip stash/);assert.match(stashes[0].id,/^[a-f0-9]{40}$/);
  assert.equal(g(root,'rev-parse','refs/stash').trim(),before,'stash list must not change refs/stash');
  const details=await getCommitDetails(repo,{commit:stashes[0].id});assert.ok(details.changes.some(c=>c.path==='f'),'stash diff should include the stashed file');
  assert.equal(g(root,'status','--porcelain'),'');
  g(root,'stash','drop','-q','stash@{0}');
  assert.equal((await listStashes(repo)).stashes.length,0);
 }finally{await rm(root,{recursive:true,force:true});}
});