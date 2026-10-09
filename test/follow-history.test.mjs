import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {parseFollowHistory} from '../git-history.mjs';
import {detectRepository,listFileHistory,getCommitDetails} from '../vcs.mjs';
test('follow parser refuses malformed framing mismatched paths and invalid scores',()=>{
 const oid='a'.repeat(40),header=[oid,'','author','2026-10-09T00:00:00Z','subject'].join('\0')+'\0';
 const output=header+'\nM\0path\0';assert.equal(parseFollowHistory(output,'path',1)[0].path,'path');
 for(const data of [output.slice(0,-1),header+'\nR101\0old\0path\0',header+'\nR100\0old\0',header+'\nM\0wrong\0',output+output])assert.throws(()=>parseFollowHistory(data,'path',1));
});
test('merge introduction stops at explicit first-parent identity boundary',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-follow-merge-')),git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
 try{
 git('init','-q','-b','main');git('config','user.name','Follow');git('config','user.email','f@example.test');await writeFile(path.join(root,'root.txt'),'root');git('add','.');git('commit','-qm','root');
 git('checkout','-qb','topic');await writeFile(path.join(root,'file.txt'),'topic');git('add','.');git('commit','-qm','topic file');git('checkout','-q','main');await writeFile(path.join(root,'main.txt'),'main');git('add','.');git('commit','-qm','main');git('merge','--no-ff','-q','topic','-m','merge');
 const commit=git('rev-parse','HEAD').trim(),repo=await detectRepository(root),details=await getCommitDetails(repo,{commit}),entry=details.changes.find(c=>c.path==='file.txt');
 const page=await listFileHistory(repo,{commit,id:entry.id,follow:true});assert.equal(page.commits.length,1);assert.equal(page.commits[0].boundary,'merge-first-parent');assert.equal(page.nextOffset,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('follow stops at copy creation similarity rename and deleted path recreation',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-follow-boundary-')),git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
 try{
 git('init','-q');git('config','user.name','Follow');git('config','user.email','f@example.test');
 const content=Array.from({length:100},(_,i)=>'line '+i).join('\n');await writeFile(path.join(root,'source.txt'),content);git('add','.');git('commit','-qm','source');
 const history=async name=>{const commit=git('rev-parse','HEAD').trim(),repo=await detectRepository(root),details=await getCommitDetails(repo,{commit}),entry=details.changes.find(c=>c.path===name);return listFileHistory(repo,{commit,id:entry.id,follow:true});};
 await writeFile(path.join(root,'copy.txt'),content);git('add','.');git('commit','-qm','copy creation');assert.deepEqual((await history('copy.txt')).commits.map(c=>c.subject),['copy creation']);
 git('mv','copy.txt','edited.txt');await writeFile(path.join(root,'edited.txt'),content+'\nchanged');git('add','.');git('commit','-qm','similarity rename');assert.deepEqual((await history('edited.txt')).commits.map(c=>c.subject),['similarity rename']);
 git('rm','-q','edited.txt');git('commit','-qm','delete');assert.equal((await history('edited.txt')).commits[0].subject,'delete');
 await writeFile(path.join(root,'edited.txt'),'unrelated');git('add','.');git('commit','-qm','recreated');assert.deepEqual((await history('edited.txt')).commits.map(c=>c.subject),['recreated']);
 }finally{await rm(root,{recursive:true,force:true});}
});
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
