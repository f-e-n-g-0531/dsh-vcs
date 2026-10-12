import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {detectRepository,searchRepositoryContent} from '../vcs.mjs';
const g=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
test('content search is literal, bounded, binary-skipping and read-only',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vcs-grep-'));
 try{
  g(root,'init','-q');g(root,'config','user.name','T');g(root,'config','user.email','t@example.test');
  await writeFile(path.join(root,'a.txt'),'foo bar\nsecond\nfoo again\n');await writeFile(path.join(root,'b.txt'),'nofoo\n');await writeFile(path.join(root,'c.bin'),Buffer.from([0,1,2,102,111,111,0,3]));
  g(root,'add','.');g(root,'commit','-q','-m','base');const head=g(root,'rev-parse','HEAD').trim();const repo=await detectRepository(root);
  const m=await searchRepositoryContent(repo,{commit:head,query:'foo'});
  assert.deepEqual(m.matches.map(x=>x.path+':'+x.line),['a.txt:1','a.txt:3','b.txt:1']);
  assert.equal(m.matches[0].text,'foo bar');
  assert.equal((await searchRepositoryContent(repo,{commit:head,query:'.'})).matches.length,0,'dot must be literal, not a regex wildcard');
  assert.equal((await searchRepositoryContent(repo,{commit:head,query:'zzz'})).matches.length,0);
  await assert.rejects(searchRepositoryContent(repo,{commit:head,query:''}));
  await assert.rejects(searchRepositoryContent(repo,{commit:head,query:'x\n'}));
  assert.equal(g(root,'status','--porcelain'),'');
 }finally{await rm(root,{recursive:true,force:true});}
});