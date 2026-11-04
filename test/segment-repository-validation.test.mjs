import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {gitCommand} from './helpers/git-command.mjs';
import {getHistoricalSegment,getHistoricalFile,clearHistoricalCache} from '../vcs.mjs';

test('segment requests revalidate root commit and path without unrelated HEAD metadata',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'vcs-segment-root-')));
 t.after(async()=>{clearHistoricalCache(root);await fs.rm(root,{recursive:true,force:true,maxRetries:5});});
 const g=gitCommand(root);g('init','-q');g('config','user.name','T');g('config','user.email','t@example.test');g('config','core.autocrlf','false');await fs.writeFile(path.join(root,'f'),'line\n'.repeat(20000));g('add','.');g('commit','-qm','base');const commit=g('rev-parse','HEAD').trim(),repo={root,type:'git'};
 const original=childProcess.spawn,calls=[];
 childProcess.spawn=(command,args,options)=>{if(command==='git')calls.push([...args]);return original(command,args,options);};syncBuiltinESMExports();
 try {
  const first=await getHistoricalSegment(repo,{commit,path:'f'});assert.ok(first.nextOffset>0);calls.length=0;
  const next=await getHistoricalSegment(repo,{commit,path:'f',offset:first.nextOffset});assert.equal(next.oid,first.oid);
  assert.equal(calls.length,3);assert.ok(calls.some(a=>a.includes('rev-parse')&&a.includes('--show-toplevel')));assert.ok(calls.some(a=>a.includes('cat-file')&&a.includes('-t')&&a.includes(commit)));assert.ok(calls.some(a=>a.includes('ls-tree')&&a.includes(commit)&&a.at(-1)==='f'));assert.ok(!calls.some(a=>a.includes('symbolic-ref')||a.includes('--short')));
  calls.length=0;await getHistoricalFile(repo,{commit,path:'f'});assert.ok(calls.some(a=>a.includes('symbolic-ref')),'other callers retain branch metadata');
  const nested=path.join(root,'nested');await fs.mkdir(nested);calls.length=0;await assert.rejects(getHistoricalSegment({root:nested,type:'git'},{commit,path:'f'}),/Repository root changed/);assert.ok(!calls.some(a=>a.includes('ls-tree')));
  await assert.rejects(getHistoricalSegment(repo,{commit,path:'missing'}),/selected committed regular file/);
  const tree=g('rev-parse','HEAD^{tree}').trim();await assert.rejects(getHistoricalSegment(repo,{commit:tree,path:'f'}),/Commit object required/);
  const controller=new AbortController();controller.abort();calls.length=0;await assert.rejects(getHistoricalSegment(repo,{commit,path:'f',signal:controller.signal}));assert.equal(calls.length,0);
  g('checkout','--detach','-q',commit);calls.length=0;assert.equal((await getHistoricalSegment(repo,{commit,path:'f',line:2})).startLine,2);assert.equal(calls.length,3);
 }finally{childProcess.spawn=original;syncBuiltinESMExports();}
});
