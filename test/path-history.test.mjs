import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rename,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {gitCommand} from './helpers/git-command.mjs';
import {detectRepository,getCommitDetails,listFileHistory,listPathHistory,listHistory} from '../vcs.mjs';
test('explicit historical path history paginates and never follows renames unless requested',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vcs-path-history-'));const git=gitCommand(root);
 try{
  git('init','-q');git('config','user.name','Test');git('config','user.email','t@example.test');
  await writeFile(path.join(root,'old.txt'),'one\n');git('add','.');git('commit','-qm','create old');
  await writeFile(path.join(root,'old.txt'),'two\n');git('commit','-qam','edit old');
  await rename(path.join(root,'old.txt'),path.join(root,'new.txt'));git('add','-A');git('commit','-qm','rename to new');
  await writeFile(path.join(root,'new.txt'),'three\n');git('commit','-qam','edit new');
  const repo=await detectRepository(root),head=git('rev-parse','HEAD').trim();
  const plain=await listPathHistory(repo,{commit:head,path:'new.txt'});
  assert.deepEqual(plain.commits.map(row=>row.subject),['edit new','rename to new']);assert.equal(plain.followsRenames,false);assert.equal(plain.path,'new.txt');
  const followed=await listPathHistory(repo,{commit:head,path:'new.txt',follow:true});
  assert.deepEqual(followed.commits.map(row=>row.subject),['edit new','rename to new','edit old','create old']);assert.equal(followed.followsRenames,true);assert.equal(followed.followPolicy,'unique-similarity-first-parent');
  const page=await listPathHistory(repo,{commit:head,path:'new.txt',follow:true,offset:1,limit:2});
  assert.deepEqual(page.commits.map(row=>row.subject),['rename to new','edit old']);assert.equal(page.nextOffset,3);
  const early=git('rev-parse','HEAD~2').trim();
  assert.deepEqual((await listPathHistory(repo,{commit:early,path:'old.txt'})).commits.map(row=>row.subject),['edit old','create old']);
  await assert.rejects(listPathHistory(repo,{commit:early,path:'new.txt'}),/does not exist/);
  await assert.rejects(listPathHistory(repo,{commit:head,path:'new.txt',follow:true,offset:-1}));
  await assert.rejects(listPathHistory(repo,{commit:head,path:'../escape'}));
  await assert.rejects(listPathHistory(repo,{commit:head,path:'/absolute'}));
  await assert.rejects(listPathHistory(repo,{commit:head,path:''}));
  await assert.rejects(listPathHistory(repo,{commit:'not-a-commit',path:'new.txt'}));
  await assert.rejects(listPathHistory(repo,{commit:head,path:'new.txt',follow:'yes'}));
  const controller=new AbortController();controller.abort();
  await assert.rejects(listPathHistory(repo,{commit:head,path:'new.txt',signal:controller.signal}),{name:'AbortError'});
  assert.equal(git('status','--porcelain'),'');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('explicit path history follow matches change-id file history for the same commit and path',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vcs-path-parity-'));const git=gitCommand(root);
 try{
  git('init','-q');git('config','user.name','Test');git('config','user.email','t@example.test');
  await writeFile(path.join(root,'a.txt'),'one\n');git('add','.');git('commit','-qm','create');
  await rename(path.join(root,'a.txt'),path.join(root,'b.txt'));git('add','-A');git('commit','-qm','rename');
  await writeFile(path.join(root,'b.txt'),'two\n');git('commit','-qam','edit');
  const repo=await detectRepository(root),snapshot=(await listHistory(repo)).commits[0].id;
  const entry=(await getCommitDetails(repo,{commit:snapshot})).changes.find(row=>row.path==='b.txt');
  const byId=await listFileHistory(repo,{commit:snapshot,parentIndex:0,id:entry.id,follow:true});
  const byPath=await listPathHistory(repo,{commit:snapshot,path:'b.txt',follow:true});
  assert.deepEqual(byPath.commits,byId.commits);assert.equal(byPath.path,byId.path);assert.equal(byPath.followPolicy,byId.followPolicy);
 }finally{await rm(root,{recursive:true,force:true});}
});
