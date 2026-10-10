import test from 'node:test';import assert from 'node:assert/strict';import * as fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {createHandler} from '../index.mjs';import * as vcs from '../vcs.mjs';
const data=Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAkAAEAdQqFIUuYCBiOh/AAA=','base64');
test('authorized VP8L Git workspace modes historical and rename sides preserve bytes',async()=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'vcs-vp8l-'))),git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
 try{
  git('init','-q');git('config','user.name','Test');git('config','user.email','t@example.test');git('config','core.autocrlf','false');await fs.writeFile(path.join(root,'image.webp'),data);git('add','.');git('commit','-qm','image');const base=git('rev-parse','HEAD').trim();
  const call=createHandler({sessions:{get:()=>({header:{cwd:root}})}},vcs);const discovered=await call('vcs/repositories',{sessionId:'s'});assert.ok(discovered.ok);const p={sessionId:'s',repositoryId:discovered.value.repositories[0].id};
  const details=await call('vcs/commit',{...p,commit:base});const oldId=details.value.changes[0].id;await fs.writeFile(path.join(root,'image.webp'),'invalid index');git('add','.');await fs.writeFile(path.join(root,'image.webp'),data);
  const historical=await call('vcs/commit-image',{...p,commit:base,id:oldId});assert.ok(historical.ok);assert.deepEqual(Buffer.from(historical.value.base64,'base64'),data);assert.equal(historical.value.width,3);
  for(const [mode,side,ok] of [['all','right',true],['staged','left',true],['staged','right',false],['unstaged','left',false],['unstaged','right',true]]){const status=await call('vcs/status',{...p,mode});const result=await call('vcs/workspace-image',{...p,mode,id:status.value.changes[0].id,side});assert.equal(result.ok,ok);if(ok)assert.deepEqual(Buffer.from(result.value.base64,'base64'),data);}
  git('reset','--hard','HEAD');git('mv','image.webp','renamed.webp');git('commit','-qm','rename');const target=git('rev-parse','HEAD').trim();const pair=await call('vcs/revision-changes',{...p,base,target});const id=pair.value.changes[0].id;await fs.writeFile(path.join(root,'renamed.webp'),'uncommitted');
  for(const side of ['left','right']){const result=await call('vcs/revision-image',{...p,base,target,id,side});assert.ok(result.ok);assert.deepEqual(Buffer.from(result.value.base64,'base64'),data);}
  const cancelled=new AbortController();cancelled.abort();assert.equal((await call('vcs/commit-image',{...p,commit:base,id:oldId},cancelled.signal)).error.code,'vcs/cancelled');
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
