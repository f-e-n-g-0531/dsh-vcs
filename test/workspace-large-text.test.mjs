import test from 'node:test';import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {writeFileSync} from 'node:fs';
import {readWorkspaceLargeText} from '../workspace-large-text.mjs';
test('workspace reader rejects mutation and active cancellation before read completes',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'vcs-large-race-'))),file=path.join(root,'file.txt');
 try{
  await fs.writeFile(file,'original');let checks=0;
  await assert.rejects(readWorkspaceLargeText(root,'file.txt',undefined,()=>{if(++checks===2)writeFileSync(file,'mutated longer content');}),/changed/);
  await fs.writeFile(file,'original');checks=0;const controller=new AbortController();
  await assert.rejects(readWorkspaceLargeText(root,'file.txt',controller.signal,()=>{if(++checks===2)controller.abort();}));
  await fs.writeFile(file,'after abort');assert.equal(await fs.readFile(file,'utf8'),'after abort');
  await fs.mkdir(path.join(root,'real'));await fs.writeFile(path.join(root,'real','nested.txt'),'inside');
  await fs.symlink(path.join(root,'real'),path.join(root,'linked'),process.platform==='win32'?'junction':'dir');
  await assert.rejects(readWorkspaceLargeText(root,'linked/nested.txt'),/links/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('workspace large reader returns complete text and rejects later replacement or mutation',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'vcs-large-work-')));
 try{
  const text=('unicode 中文 '+ 'x'.repeat(100)+'\n').repeat(25000),file=path.join(root,'file.txt');await fs.writeFile(file,text);
  const result=await readWorkspaceLargeText(root,'file.txt');assert.equal(result.value.text,text);await result.verify();
  await fs.writeFile(file,'changed');await assert.rejects(result.verify,/changed/);
  await fs.writeFile(file,Buffer.from([255]));await assert.rejects(readWorkspaceLargeText(root,'file.txt'),/UTF-8/);
  await fs.writeFile(file,'x'.repeat(8*1024*1024+1));await assert.rejects(readWorkspaceLargeText(root,'file.txt'),/8 MiB/);
  await assert.rejects(readWorkspaceLargeText(root,'../outside'),/escapes/);
  await assert.rejects(readWorkspaceLargeText(root,'file.txt',undefined,()=>{throw Object.assign(Error('deadline'),{code:'TIMEOUT'});}),{code:'TIMEOUT'});
  const c=new AbortController();c.abort();await assert.rejects(readWorkspaceLargeText(root,'file.txt',c.signal));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
