import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {detectRepository,searchRepositoryContent} from '../vcs.mjs';
test('grep preserves LF tab colon and Unicode in committed filenames',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vcs-grep-newline-')),lf=String.fromCharCode(10),tab=String.fromCharCode(9),nul=String.fromCharCode(0);
 const g=(args,input)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',input,windowsHide:true});
 try{g(['init','-q']);g(['config','user.name','T']);g(['config','user.email','t@example.test']);
 const blob=g(['hash-object','-w','--stdin'],'needle'+lf+'needle last').trim(),names=['normal.txt','line'+lf+'break.txt','tab'+tab+'colon:中文.txt'].sort();
 const tree=g(['mktree','-z'],names.map(name=>'100644 blob '+blob+tab+name+nul).join('')).trim();
 const commit=g(['commit-tree',tree],'fixture').trim();g(['update-ref','HEAD',commit]);
 g(['config','grep.column','true']);
 g(['config','color.grep','always']);g(['config','color.ui','always']);
 const result=await searchRepositoryContent(await detectRepository(root),{commit,query:'needle'});
 assert.equal(g(['config','--get','grep.column']).trim(),'true','must not modify user configuration');
 assert.ok(result.matches.every(row=>!row.text.includes(nul)));
 assert.equal(result.matches.length,6);for(const name of names)assert.deepEqual(result.matches.filter(x=>x.path===name).map(x=>[x.line,x.text]),[[1,'needle'],[2,'needle last']]);
 }finally{await rm(root,{recursive:true,force:true});}
});
