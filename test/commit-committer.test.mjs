import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {detectRepository,getCommitDetails} from '../vcs.mjs';
const g=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
test('commit details distinguish committer from author and match for same-identity commits',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vcs-committer-'));
 try{
  g(root,'init','-q');g(root,'config','user.name','Committer');g(root,'config','user.email','c@example.test');
  await writeFile(path.join(root,'f'),'x\n');g(root,'add','.');g(root,'commit','-q','--author','Author <a@example.test>','-m','mixed identity');const mixed=g(root,'rev-parse','HEAD').trim();
  await writeFile(path.join(root,'f'),'y\n');g(root,'config','user.name','T');g(root,'config','user.email','t@example.test');g(root,'add','.');g(root,'commit','-q','-m','same identity');const same=g(root,'rev-parse','HEAD').trim();
  const repo=await detectRepository(root);
  const detail=await getCommitDetails(repo,{commit:mixed});
  assert.equal(detail.author,'Author');assert.equal(detail.committer,'Committer');assert.match(detail.committerDate,/^\d{4}-\d{2}-\d{2}T/);
  const normal=await getCommitDetails(repo,{commit:same});assert.equal(normal.author,'T');assert.equal(normal.committer,'T');
  assert.equal(g(root,'status','--porcelain'),'');
 }finally{await rm(root,{recursive:true,force:true});}
});