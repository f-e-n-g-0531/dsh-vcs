import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHandler} from '../index.mjs';

test('large comparison RPC requires boolean opt-in and shares heavy slot with segments', async () => {
  let finish, enter; const entered = new Promise(resolve => enter = resolve);
  let cwd = '/workspace';
  const repo = {id: 'r', type: 'git', root: cwd};
  const options = [];
  const read = async (_repo, opts) => {options.push(opts); enter(); return new Promise(resolve => finish = resolve);};
  const call = createHandler({sessions:{get:()=>({header:{cwd}})}}, {
    discoverRepositories: async()=>({repositories:[repo],warnings:[]}),
    getCommitComparison: read, getRevisionComparison: read,
    getHistoricalSegment: async()=>({text:'segment'}), listHistory: async()=>({commits:[]}),
  });
  const p = {sessionId:'s',repositoryId:'r',commit:'a'.repeat(40),id:'b'.repeat(64),large:true};
  assert.equal((await call('vcs/commit-compare',p)).error.code, 'vcs/rediscover-required');
  await call('vcs/repositories',{sessionId:'s'});
  for (const large of [null, 1, 'true', {}, []]) assert.equal((await call('vcs/commit-compare',{...p,large})).error.code,'vcs/invalid-request');
  const first = call('vcs/commit-compare',p); await entered;
  assert.equal(options[0].large,true);
  assert.equal((await call('vcs/revision-compare',{sessionId:'s',repositoryId:'r',base:p.commit,target:'c'.repeat(40),id:p.id,large:true})).error.code,'vcs/busy');
  assert.equal((await call('vcs/tree-segment',{sessionId:'s',repositoryId:'r',commit:p.commit,path:'file'})).error.code,'vcs/busy');
  assert.equal((await call('vcs/history',{sessionId:'s',repositoryId:'r'})).ok,true);
  cwd = '/other'; finish({text:'late'});
  assert.equal((await first).error.code,'vcs/rediscover-required');
  await call('vcs/repositories',{sessionId:'s'});
  assert.equal((await call('vcs/tree-segment',{sessionId:'s',repositoryId:'r',commit:p.commit,path:'file'})).ok,true);
});

test('real Git large comparisons read complete fixed versions including rename and empty sides', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'vcs-large-diff-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
  const git = args => {const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
  git(['init','-b','main']);git(['config','user.name','Large']);git(['config','user.email','large@example.invalid']);git(['config','core.autocrlf','false']);
  const before = ('line '+ 'x'.repeat(110)+'\n').repeat(24000);
  const after = 'inserted\n'+before.replace('line ','modified ');
  await fs.writeFile(path.join(root,'before.txt'),before);git(['add','.']);git(['commit','--no-gpg-sign','-m','base']);const base=git(['rev-parse','HEAD']);
  git(['mv','before.txt','after.txt']);await fs.writeFile(path.join(root,'after.txt'),after);git(['add','.']);git(['commit','--no-gpg-sign','-m','rename']);const target=git(['rev-parse','HEAD']);
  await fs.writeFile(path.join(root,'after.txt'),'WORKING');
  const status=git(['status','--porcelain']),index=git(['ls-files','--stage']);
  const call=createHandler({sessions:{get:()=>({header:{cwd:root}})}});
  const scan=await call('vcs/repositories',{sessionId:'s'});assert.equal(scan.ok,true,JSON.stringify(scan));
  const address={sessionId:'s',repositoryId:scan.value.repositories.find(r=>r.type==='git').id};
  const read=async(endpoint,opts)=>{const r=await call(endpoint,{...address,...opts});assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
  const details=await read('vcs/commit',{commit:target});assert.equal(details.changes.length,1);
  const id=details.changes[0].id;
  const ordinary=await read('vcs/commit-compare',{commit:target,id});assert.equal(ordinary.left.text,'');assert.match(ordinary.notice,/2 MiB/);
  const complete=await read('vcs/commit-compare',{commit:target,id,large:true});assert.equal(complete.left.text,before);assert.equal(complete.right.text,after);assert.equal(complete.large,true);
  const pair=await read('vcs/revision-changes',{base,target});const diff=await read('vcs/revision-compare',{base,target,id:pair.changes[0].id,large:true});assert.equal(diff.left.text,before);assert.equal(diff.right.text,after);
  const rootDetail=await read('vcs/commit',{commit:base});const added=await read('vcs/commit-compare',{commit:base,id:rootDetail.changes[0].id,large:true});assert.equal(added.left.text,'');assert.equal(added.right.text,before);
  assert.equal((await call('vcs/commit-compare',{...address,commit:target,id:'f'.repeat(64),large:true})).ok,false);
  const abort=new AbortController();abort.abort();assert.equal((await call('vcs/commit-compare',{...address,commit:target,id,large:true},abort.signal)).error.code,'vcs/cancelled');
  assert.equal(git(['status','--porcelain']),status);assert.equal(git(['ls-files','--stage']),index);assert.equal(await fs.readFile(path.join(root,'after.txt'),'utf8'),'WORKING');
});
