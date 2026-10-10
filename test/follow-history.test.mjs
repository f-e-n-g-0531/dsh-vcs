import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {gitCommand} from './helpers/git-command.mjs';
import {parseFollowHistory} from '../git-history.mjs';
import {detectRepository,listFileHistory,getCommitDetails} from '../vcs.mjs';
test('follow parser refuses malformed framing mismatched paths and invalid scores',()=>{
 const oid='a'.repeat(40),header=[oid,'','author','2026-10-09T00:00:00Z','subject'].join('\0')+'\0';
 const output=header+'\nM\0path\0';assert.equal(parseFollowHistory(output,'path',1)[0].path,'path');
 for(const score of [50,87,100]){const rows=parseFollowHistory(header+'\nR'+score+'\0old\0path\0','path',1,{similarity:true});assert.equal(rows[0].oldPath,'old');assert.equal(rows[0].similarity,score);}
 assert.equal(parseFollowHistory(header+'\nR49\0old\0path\0','path',1,{similarity:true})[0].boundary,'copy-or-inexact-rename');
 for(const data of [output.slice(0,-1),header+'\nR101\0old\0path\0',header+'\nR100\0old\0',header+'\nM\0wrong\0',output+output])assert.throws(()=>parseFollowHistory(data,'path',1));
});
test('merge introduction stops at explicit first-parent identity boundary',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-follow-merge-')),git=gitCommand(root);
 try{
 git('init','-q','-b','main');git('config','user.name','Follow');git('config','user.email','f@example.test');await writeFile(path.join(root,'root.txt'),'root');git('add','.');git('commit','-qm','root');
 git('checkout','-qb','topic');await writeFile(path.join(root,'file.txt'),'topic');git('add','.');git('commit','-qm','topic file');git('checkout','-q','main');await writeFile(path.join(root,'main.txt'),'main');git('add','.');git('commit','-qm','main');git('merge','--no-ff','-q','topic','-m','merge');
 const commit=git('rev-parse','HEAD').trim(),repo=await detectRepository(root),details=await getCommitDetails(repo,{commit}),entry=details.changes.find(c=>c.path==='file.txt');
 const page=await listFileHistory(repo,{commit,id:entry.id,follow:true});assert.equal(page.commits.length,1);assert.equal(page.commits[0].boundary,'merge-first-parent');assert.equal(page.nextOffset,null);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('follow crosses unique similarity rename but stops at copy creation and deleted path recreation',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-follow-boundary-')),git=gitCommand(root);
 try{
 git('init','-q');git('config','user.name','Follow');git('config','user.email','f@example.test');
 const content=Array.from({length:100},(_,i)=>'line '+i).join('\n');await writeFile(path.join(root,'source.txt'),content);git('add','.');git('commit','-qm','source');
 const history=async name=>{const commit=git('rev-parse','HEAD').trim(),repo=await detectRepository(root),details=await getCommitDetails(repo,{commit}),entry=details.changes.find(c=>c.path===name);return listFileHistory(repo,{commit,id:entry.id,follow:true});};
 await writeFile(path.join(root,'copy.txt'),content);git('add','.');git('commit','-qm','copy creation');assert.deepEqual((await history('copy.txt')).commits.map(c=>c.subject),['copy creation']);
 git('mv','copy.txt','edited.txt');await writeFile(path.join(root,'edited.txt'),content+'\nchanged');git('add','.');git('commit','-qm','similarity rename');const renamed=await history('edited.txt');assert.deepEqual(renamed.commits.map(c=>c.subject),['similarity rename','copy creation']);assert.ok(renamed.commits[0].similarity>=50&&renamed.commits[0].similarity<100);assert.equal(renamed.commits[1].path,'copy.txt');
 git('rm','-q','edited.txt');git('commit','-qm','delete');assert.equal((await history('edited.txt')).commits[0].subject,'delete');
 await writeFile(path.join(root,'edited.txt'),'unrelated');git('add','.');git('commit','-qm','recreated');assert.deepEqual((await history('edited.txt')).commits.map(c=>c.subject),['recreated']);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('similar rename rejects competing deletions and replay preserves old path',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-follow-ambiguous-')),git=gitCommand(root);
 try{
  git('init','-q');git('config','user.name','Follow');git('config','user.email','f@example.test');git('config','core.autocrlf','false');
  const content=Array.from({length:100},(_,i)=>'line '+i).join('\n');await writeFile(path.join(root,'old.txt'),content);git('add','.');git('commit','-qm','create');
  git('mv','old.txt','new.txt');await writeFile(path.join(root,'new.txt'),content+'\nchange');git('add','.');git('commit','-qm','rename with edit');
  let commit=git('rev-parse','HEAD').trim(),repo=await detectRepository(root),detail=await getCommitDetails(repo,{commit});
  const page=await listFileHistory(repo,{commit,id:detail.changes[0].id,follow:true,limit:1});assert.equal(page.nextOffset,1);
  const next=await listFileHistory(repo,{commit,id:detail.changes[0].id,follow:true,offset:1,limit:1});assert.equal(next.commits[0].path,'old.txt');
  await writeFile(path.join(root,'competitor.txt'),content);git('add','.');git('commit','-qm','competitor');
  git('mv','new.txt','final.txt');git('rm','competitor.txt');await writeFile(path.join(root,'final.txt'),content+'\nchanged again');git('add','.');git('commit','-qm','ambiguous');
  commit=git('rev-parse','HEAD').trim();detail=await getCommitDetails(repo,{commit});const entry=detail.changes.find(row=>row.path==='final.txt');
  const stopped=await listFileHistory(repo,{commit,id:entry.id,follow:true});assert.equal(stopped.commits.length,1);assert.equal(stopped.commits[0].boundary,'ambiguous-rename');assert.equal(stopped.nextOffset,null);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('exact rename with identical competing deleted source stops',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-follow-exact-ambiguous-')),git=gitCommand(root);
 try{
  git('init','-q');git('config','user.name','Follow');git('config','user.email','f@example.test');
  for(const name of ['one.txt','two.txt'])await writeFile(path.join(root,name),'identical');git('add','.');git('commit','-qm','sources');
  git('mv','one.txt','new.txt');git('rm','two.txt');git('commit','-qm','ambiguous exact');
  const commit=git('rev-parse','HEAD').trim(),repo=await detectRepository(root),details=await getCommitDetails(repo,{commit}),entry=details.changes.find(row=>row.path==='new.txt');
  const page=await listFileHistory(repo,{commit,id:entry.id,follow:true});assert.equal(page.commits.length,1);assert.equal(page.commits[0].boundary,'ambiguous-rename');
 }finally{await rm(root,{recursive:true,force:true});}
});

test('exact rename chain has historical paths and pagination crosses earlier rename',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-follow-')),git=gitCommand(root);
 try{
 git('init','-q');git('config','user.name','Follow');git('config','user.email','f@example.test');await writeFile(path.join(root,'old.txt'),'same');git('add','.');git('commit','-qm','create');
 git('mv','old.txt','middle.txt');git('commit','-qm','rename1');git('mv','middle.txt','new.txt');git('commit','-qm','rename2');
 const commit=git('rev-parse','HEAD').trim(),repo=await detectRepository(root),details=await getCommitDetails(repo,{commit}),id=details.changes[0].id;
 const page=await listFileHistory(repo,{commit,id,follow:true,limit:1});assert.equal(page.commits[0].path,'new.txt');assert.equal(page.commits[0].oldPath,'middle.txt');assert.equal(page.nextOffset,1);
 const next=await listFileHistory(repo,{commit,id,follow:true,offset:1,limit:2});assert.deepEqual(next.commits.map(r=>r.path),['middle.txt','old.txt']);assert.equal(next.nextOffset,null);
 assert.equal((await listFileHistory(repo,{commit,id})).commits.length,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
