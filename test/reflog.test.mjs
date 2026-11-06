import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {listReflog} from '../vcs.mjs';
import {parseReflog,REFLOG_MAX_OUTPUT} from '../src/reflog.mjs';

const g=(root,args,env={})=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});
async function fixture(work,format='sha1') {
 const temp=await mkdtemp(path.join(os.tmpdir(),'vcs-reflog-'));
 try {
  const root=await realpath(temp);
  g(root,['init','-q','--object-format='+format]);
  g(root,['config','user.name','Reflog Test']);g(root,['config','user.email','reflog@example.test']);
  g(root,['config','commit.gpgsign','false']);g(root,['config','core.logAllRefUpdates','true']);
  await work({root,type:'git'});
 } finally {await rm(temp,{recursive:true,force:true});}
}
function commit(repo,message,date) {
 return g(repo.root,['commit','--allow-empty','-q','-m',message],{GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date});
}
async function metadata(root) {
 const result={};
 async function walk(relative) {
  const absolute=path.join(root,'.git',relative);
  let entries;
  try {entries=await readdir(absolute,{withFileTypes:true});}
  catch(e) {if(e.code==='ENOENT')return;throw e;}
  for(const entry of entries) {
   const rel=path.join(relative,entry.name);
   if(entry.isDirectory())await walk(rel);
   else result[rel]=(await readFile(path.join(root,'.git',rel))).toString('hex');
  }
 }
 // Includes HEAD, index, refs, logs, config, objects: stricter than selected invariants.
 await walk('');return result;
}

test('HEAD movements expose reflog event ISO dates and Unicode; reads preserve metadata/index/refs/logs',async()=>fixture(async repo=>{
 await writeFile(path.join(repo.root,'tracked'),'original\n');g(repo.root,['add','tracked']);
 commit(repo,'初次 🌿','2024-01-02T03:04:05+08:00');
 const first=g(repo.root,['rev-parse','HEAD']).trim();
 commit(repo,'second','2024-02-03T04:05:06-03:00');
 g(repo.root,['checkout','-q','--detach',first],{GIT_COMMITTER_DATE:'2024-03-04T05:06:07+00:00'});
 await writeFile(path.join(repo.root,'tracked'),'staged\n');g(repo.root,['add','tracked']);
 await writeFile(path.join(repo.root,'tracked'),'unstaged\n');
 const before=await metadata(repo.root),result=await listReflog(repo);
 assert.equal(result.truncated,false);assert.equal(result.entries.length,3);
 assert.equal(result.entries[0].id,first);
 assert.equal(result.entries[0].date,'2024-03-04T05:06:07Z');
 assert.equal(result.entries[1].date,'2024-02-03T04:05:06-03:00');
 assert.equal(result.entries[2].message,'commit (initial): 初次 🌿');
 for(const row of result.entries)assert.equal(row.selector,'HEAD@{'+row.date+'}');
 assert.deepEqual(await metadata(repo.root),before);
 assert.equal(await readFile(path.join(repo.root,'tracked'),'utf8'),'unstaged\n');
}));

test('single snapshot returns 200 entries with 201 lookahead, never partial oversized output',async()=>fixture(async repo=>{
 commit(repo,'seed','2024-01-01T00:00:00+00:00');
 const a=g(repo.root,['rev-parse','HEAD']).trim();
 commit(repo,'next','2024-01-02T00:00:00+00:00');
 const b=g(repo.root,['rev-parse','HEAD']).trim();
 // Batch fixture writes avoid spawning hundreds of commands; production is read-only.
 const commands=Array.from({length:198},(_,i)=>'start\nupdate HEAD '+(i%2?a:b)+'\nprepare\ncommit').join('\n')+'\n';
 execFileSync('git',['-C',repo.root,'update-ref','--stdin','-m','界 movement'],{input:commands,stdio:['pipe','ignore','pipe'],windowsHide:true});
 const exactly=await listReflog(repo);assert.equal(exactly.entries.length,200);assert.equal(exactly.truncated,false);
 g(repo.root,['update-ref','-m','lookahead','HEAD',b]);
 // Last batch update ended at a; this writes the 201st movement.
 const bounded=await listReflog(repo);assert.equal(bounded.entries.length,200);assert.equal(bounded.truncated,true);
 const huge='x'.repeat(12000);
 const more=Array.from({length:201},(_,i)=>'start\nupdate HEAD '+(i%2?b:a)+'\nprepare\ncommit').join('\n')+'\n';
 execFileSync('git',['-C',repo.root,'update-ref','--stdin','-m',huge],{input:more,stdio:['pipe','ignore','pipe'],windowsHide:true});
 await assert.rejects(listReflog(repo),{code:'TOO_LARGE'});
}));

test('unborn and existing HEAD without reflog return proven empty; corruption rejects',async()=>fixture(async repo=>{
 assert.deepEqual(await listReflog(repo),{entries:[],truncated:false});
 g(repo.root,['config','core.logAllRefUpdates','false']);
 commit(repo,'no log','2024-01-01T00:00:00+00:00');
 assert.deepEqual(await listReflog(repo),{entries:[],truncated:false});
 await writeFile(path.join(repo.root,'.git','HEAD'),'corrupt HEAD\n');
 await assert.rejects(listReflog(repo));
}));

test('SHA256 repository OIDs are accepted',async()=>fixture(async repo=>{
 commit(repo,'sha256','2024-01-01T00:00:00+00:00');
 const result=await listReflog(repo);assert.equal(result.entries.length,1);assert.match(result.entries[0].id,/^[a-f0-9]{64}$/);
},'sha256'));

test('cancel before and during command execution rejects without changing repository',async()=>fixture(async repo=>{
 commit(repo,'seed','2024-01-01T00:00:00+00:00');const before=await metadata(repo.root);
 const early=new AbortController();early.abort();await assert.rejects(listReflog(repo,{signal:early.signal}));
 const controller=new AbortController(),pending=listReflog(repo,{signal:controller.signal});
 controller.abort();await assert.rejects(pending);
 assert.deepEqual(await metadata(repo.root),before);
}));

const id='a'.repeat(40),date='2024-01-02T03:04:05+08:00';
const record=(oid=id,selector='HEAD@{'+date+'}',message='message')=>[oid,selector,message,''].join('\0');
test('strict framing, OIDs, selectors, dates, UTF8, and complete lookahead validation',()=>{
 assert.deepEqual(parseReflog(Buffer.alloc(0)),{entries:[],truncated:false});
 assert.equal(parseReflog(Buffer.from(record())).entries[0].date,date);
 for(const bad of [record().slice(0,-1),record()+'\n',record()+'\0',record('a'.repeat(39)),record('g'.repeat(40)),record(id,'refs/heads/main@{0}'),record(id,'HEAD@{0}'),record(id,'HEAD@{2024-99-01T00:00:00+00:00}'),record(id,'HEAD@{2024-02-30T00:00:00Z}'),record(id,undefined,'bad\nline'),record(id,undefined,'bad\0field'),record().repeat(202),record().repeat(200)+record('invalid')])assert.throws(()=>parseReflog(Buffer.from(bad)),/Invalid HEAD reflog/);
 assert.throws(()=>parseReflog(Buffer.from([0xff])),/Invalid HEAD reflog/);
 assert.throws(()=>parseReflog(Buffer.alloc(REFLOG_MAX_OUTPUT+1)),/Invalid HEAD reflog/);
 assert.equal(parseReflog(Buffer.from(record().repeat(201))).truncated,true);
});
