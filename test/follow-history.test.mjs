import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {detectRepository,listFileHistory,getCommitDetails} from '../vcs.mjs';
test('exact rename chain has historical paths and pagination crosses earlier rename',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-follow-')),git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
 try{
 git('init','-q');git('config','user.name','Follow');git('config','user.email','f@example.test');await writeFile(path.join(root,'old.txt'),'same');git('add','.');git('commit','-qm','create');
 git('mv','old.txt','middle.txt');git('commit','-qm','rename1');git('mv','middle.txt','new.txt');git('commit','-qm','rename2');
 const commit=git('rev-parse','HEAD').trim(),repo=await detectRepository(root),details=await getCommitDetails(repo,{commit}),id=details.changes[0].id;
 const page=await listFileHistory(repo,{commit,id,follow:true,limit:1});assert.equal(page.commits[0].path,'new.txt');assert.equal(page.commits[0].oldPath,'middle.txt');assert.equal(page.nextOffset,1);
 const next=await listFileHistory(repo,{commit,id,follow:true,offset:1,limit:2});assert.deepEqual(next.commits.map(r=>r.path),['middle.txt','old.txt']);assert.equal(next.nextOffset,null);
 assert.equal((await listFileHistory(repo,{commit,id})).commits.length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
