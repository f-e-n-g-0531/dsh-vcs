import test from 'node:test';import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {readWorkspaceLargeText} from '../workspace-large-text.mjs';
test('workspace large reader returns complete text and rejects later replacement or mutation',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'vcs-large-work-')));
 try{
  const text=('unicode 中文 '+ 'x'.repeat(100)+'\n').repeat(25000),file=path.join(root,'file.txt');await fs.writeFile(file,text);
  const result=await readWorkspaceLargeText(root,'file.txt');assert.equal(result.value.text,text);await result.verify();
  await fs.writeFile(file,'changed');await assert.rejects(result.verify,/changed/);
  await fs.writeFile(file,Buffer.from([255]));await assert.rejects(readWorkspaceLargeText(root,'file.txt'),/UTF-8/);
  await fs.writeFile(file,'x'.repeat(8*1024*1024+1));await assert.rejects(readWorkspaceLargeText(root,'file.txt'),/8 MiB/);
  await assert.rejects(readWorkspaceLargeText(root,'../outside'),/escapes/);
  const c=new AbortController();c.abort();await assert.rejects(readWorkspaceLargeText(root,'file.txt',c.signal));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
