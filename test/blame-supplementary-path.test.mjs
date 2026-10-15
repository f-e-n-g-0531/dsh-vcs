import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {decodeBlamePath} from '../git-history.mjs';import {detectRepository,getCommitDetails,getFileBlame,getHistoricalFile} from '../vcs.mjs';
test('quoted blame paths preserve supplementary code points beside escapes',()=>{
 const slash=String.fromCharCode(92),tab=String.fromCharCode(9);
 for(const symbol of ['😀','𠮷'])assert.equal(decodeBlamePath('"中'+symbol+slash+'t'+slash+'"end"'),'中'+symbol+tab+'"end');
 assert.equal(decodeBlamePath('plain😀'),'plain😀');assert.throws(()=>decodeBlamePath('"bad'+slash+'q"'));
});
test('real Git blame preserves quoted supplementary paths and opens exact origin',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vcs-blame-supplementary-')),lf=String.fromCharCode(10),tab=String.fromCharCode(9),nul=String.fromCharCode(0);
 const git=(args,input)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',input,windowsHide:true});
 try{git(['init','-q']);git(['config','user.name','T']);git(['config','user.email','t@example.test']);
 const name='中😀𠮷'+tab+'"file.txt',blob=git(['hash-object','-w','--stdin'],'hello'+lf).trim();const tree=git(['mktree','-z'],'100644 blob '+blob+tab+name+nul).trim(),commit=git(['commit-tree',tree],'fixture').trim();git(['update-ref','HEAD',commit]);
 const repo=await detectRepository(root),id=(await getCommitDetails(repo,{commit})).changes[0].id;
 for(const quote of ['false','true']){git(['config','core.quotepath',quote]);const row=(await getFileBlame(repo,{commit,id})).lines[0];assert.equal(row.path,name);assert.equal(row.commit,commit);assert.equal(row.originalLine,1);const file=await getHistoricalFile(repo,{commit:row.commit,path:row.path});assert.equal(file.text,'hello'+lf);}
 }finally{await rm(root,{recursive:true,force:true,maxRetries:5});}
});
