import {decodeBlamePath} from '../git-history.mjs';import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {detectRepository,getHistoricalFile,getFileBlame,getCommitDetails} from '../vcs.mjs';
test('Blame quoted paths decode Git octal UTF8 and escaped punctuation',()=>{
 assert.equal(decodeBlamePath('"\\344\\270\\255\\346\\226\\207.txt"'),'中文.txt');
 assert.equal(decodeBlamePath('"a\\t\\\\b"'),'a\t\\b');assert.throws(()=>decodeBlamePath('"bad\\q"'));
});
test('Blame renamed Unicode source maps inserted line to exact original file revision',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-blame-origin-')),git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
 try{git('init','-q');git('config','user.name','Origin');git('config','user.email','o@example.test');git('config','core.autocrlf','false');const original=Array.from({length:30},(_,i)=>'origin '+(i+1));await writeFile(path.join(root,'中文旧.txt'),original.join('\n')+'\n');git('add','.');git('commit','-qm','origin');const originCommit=git('rev-parse','HEAD').trim();git('mv','中文旧.txt','new.txt');await writeFile(path.join(root,'new.txt'),['inserted',...original].join('\n')+'\n');git('add','.');git('commit','-qm','rename insert');const commit=git('rev-parse','HEAD').trim(),repo=await detectRepository(root),id=(await getCommitDetails(repo,{commit})).changes.find(c=>c.path==='new.txt').id;
 const data=await getFileBlame(repo,{commit,id}),row=data.lines[10];assert.equal(row.line,11);assert.equal(row.originalLine,10);assert.equal(row.path,'中文旧.txt');assert.equal(row.commit,originCommit);const file=await getHistoricalFile(repo,{commit:row.commit,path:row.path});assert.equal(file.text.split('\n')[row.originalLine-1],row.text);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('Blame fixed commit windows cover beyond 500 without overlapping or reading workspace',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-blame-pages-')),git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
 try{git('init','-q');git('config','user.name','Pages');git('config','user.email','p@example.test');git('config','core.autocrlf','false');await writeFile(path.join(root,'file.txt'),Array.from({length:1002},(_,i)=>'line '+(i+1)).join('\n')+'\n');git('add','.');git('commit','-qm','lines');const commit=git('rev-parse','HEAD').trim(),repo=await detectRepository(root),id=(await getCommitDetails(repo,{commit})).changes[0].id;
 await writeFile(path.join(root,'file.txt'),'UNCOMMITTED');
 const one=await getFileBlame(repo,{commit,id}),two=await getFileBlame(repo,{commit,id,startLine:501}),three=await getFileBlame(repo,{commit,id,startLine:1001});
 assert.equal(one.nextLine,501);assert.equal(two.lines[0].line,501);assert.equal(two.lines.at(-1).line,1000);assert.equal(two.nextLine,1001);assert.equal(three.lines.length,2);assert.equal(three.lines[0].text,'line 1001');assert.equal(three.nextLine,null);assert.equal(three.totalLines,1002);
 for(const params of [{startLine:0},{startLine:100002},{lineLimit:501},{startLine:null}])await assert.rejects(getFileBlame(repo,{commit,id,...params}));
 }finally{await rm(root,{recursive:true,force:true});}
});
