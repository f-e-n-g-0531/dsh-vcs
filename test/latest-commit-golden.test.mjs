import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {git} from '../local-command.mjs';
import {readLatestCommit} from '../latest-commit.mjs';
test('latest metadata comes from fixed HEAD not changed Index or Work',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'latest-golden-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),spawn=cp.spawn;
 cp.spawn=(c,a,o)=>spawn(c,a,{...o,env:{...o.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'absent-global')}});syncBuiltinESMExports();t.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
 const run=(...a)=>git(root,a);await run('init');await run('config','user.name','Original');await run('config','user.email','original@x');await writeFile(path.join(root,'a'),'base');await run('add','a');await run('commit','-m','original message');
 await writeFile(path.join(root,'a'),'staged');await run('add','a');await writeFile(path.join(root,'a'),'work');const head=(await run('rev-parse','HEAD')).toString().trim(),index=await readFile(path.join(root,'.git','index')),objects=await readdir(path.join(root,'.git','objects'),{recursive:true});
 const result=await readLatestCommit({type:'git',root});assert.equal(result.head,head);assert.equal(result.author.name,'Original');assert.equal(result.message,'original message'+String.fromCharCode(10));
 assert.deepEqual(await readFile(path.join(root,'.git','index')),index);assert.deepEqual(await readdir(path.join(root,'.git','objects'),{recursive:true}),objects);assert.equal((await readFile(path.join(root,'a'))).toString(),'work');assert.equal((await run('rev-parse','HEAD')).toString().trim(),head);
});