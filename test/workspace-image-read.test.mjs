import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {detectRepository,listChanges,getWorkspaceImage} from '../vcs.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');

test('workspace image handles bounded short reads and still rejects EOF mutation and cancellation',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'vcs-image-read-')),file=path.join(root,'image.png'),originalOpen=fs.open;
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
  let mode='short',reads=0,closes=0,opens=0,controller;
  try {
    git('init','-q');git('config','user.name','Read test');git('config','user.email','read@example.test');git('config','core.autocrlf','false');
    await fs.writeFile(path.join(root,'base'),'base');git('add','.');git('commit','-qm','base');await fs.writeFile(file,png);
    const repo=await detectRepository(root),id=(await listChanges(repo)).find(row=>row.path==='image.png').id;
    fs.open=async(target,...args)=>{
      const handle=await originalOpen(target,...args);
      if(path.resolve(target)!==file)return handle;
      opens++;
      return {
        stat:(...args)=>handle.stat(...args),
        close:async()=>{closes++;await handle.close();},
        read:async(buffer,offset,length,position)=>{
          reads++;
          assert.equal(buffer.length,png.length+1,'retained buffer follows declared size plus one overflow byte');
          if(mode==='eof')return {bytesRead:0,buffer};
          const result=await handle.read(buffer,offset,Math.min(mode==='single-byte'?1:3,length),position);
          if(reads===1&&mode==='mutate')await fs.writeFile(file,Buffer.alloc(png.length,97));
          if(reads===1&&mode==='grow')await fs.appendFile(file,Buffer.from([1]));
          if(reads===1&&mode==='cancel')controller.abort();
          return result;
        },
      };
    };syncBuiltinESMExports();
    for(const next of ['short','single-byte']) {
      mode=next;reads=0;const result=await getWorkspaceImage(repo,{id});
      assert.deepEqual(Buffer.from(result.base64,'base64'),png);assert.ok(reads>1);assert.ok(reads<=png.length+1);
    }
    for(const next of ['eof','mutate','grow','cancel']) {
      mode=next;reads=0;controller=new AbortController();await fs.writeFile(file,png);
      await assert.rejects(getWorkspaceImage(repo,{id,signal:controller.signal}),next==='cancel'?{name:'AbortError'}:/changed/);
    }
    assert.equal(opens,6);assert.equal(closes,6,'all successful and failed reads close their descriptor');
    mode='short';await fs.writeFile(file,png);controller=new AbortController();controller.abort();
    await assert.rejects(getWorkspaceImage(repo,{id,signal:controller.signal}),{name:'AbortError'});assert.equal(opens,6);
    await fs.writeFile(file,Buffer.alloc(2097153));await assert.rejects(getWorkspaceImage(repo,{id}),/2 MiB/);assert.equal(opens,6,'oversized image is rejected before allocating or opening');
  } finally {fs.open=originalOpen;syncBuiltinESMExports();await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
});
