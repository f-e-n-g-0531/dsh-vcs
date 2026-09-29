import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHandler} from '../index.mjs';
test('real authorized RPC traverses history details and committed diff',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vcs-history-rpc-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const git=args=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(r.status,0,r.stderr);return r.stdout;};
 git(['init','-b','main']);git(['config','user.name','History']);git(['config','user.email','history@example.invalid']);git(['config','core.autocrlf','false']);
 for(const text of ['before','after']){await fs.writeFile(path.join(root,'file.txt'),text);git(['add','file.txt']);git(['commit','--no-gpg-sign','-m',text]);}
 await fs.writeFile(path.join(root,'file.txt'),'uncommitted');
 const before=git(['status','--porcelain']),head=git(['rev-parse','HEAD']);
 const handler=createHandler({sessions:{get:()=>({header:{cwd:root}})},sessionPersistence:{stat:async()=>null}});
 const scan=await handler('vcs/repositories',{sessionId:'s'});assert.equal(scan.ok,true,JSON.stringify(scan));
 const repo=scan.value.repositories.find(r=>r.type==='git');assert.ok(repo);
 const p={sessionId:'s',repositoryId:repo.id};
 const read=async(endpoint,extra={})=>{const r=await handler(endpoint,{...p,...extra});assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
 const history=await read('vcs/history',{limit:1});assert.equal(history.commits.length,1);assert.equal(history.nextOffset,1);
 const detail=await read('vcs/commit',{commit:history.commits[0].id});assert.equal(detail.changes.length,1);
 const result=await read('vcs/commit-compare',{commit:detail.id,id:detail.changes[0].id});assert.equal(result.left.text,'before');assert.equal(result.right.text,'after');
 const next=await read('vcs/history',{snapshot:history.snapshot,offset:1,limit:1});assert.equal(next.commits.length,1);assert.equal(next.nextOffset,null);
 const foreign=await handler('vcs/commit-compare',{...p,sessionId:'foreign',commit:detail.id,id:detail.changes[0].id});assert.equal(foreign.error.code,'vcs/rediscover-required');
 assert.equal(git(['status','--porcelain']),before);assert.equal(git(['rev-parse','HEAD']),head);assert.equal(await fs.readFile(path.join(root,'file.txt'),'utf8'),'uncommitted');
});
