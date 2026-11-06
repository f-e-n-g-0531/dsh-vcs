import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {git} from '../local-command.mjs';
import {prepareBranchCreate,applyBranchCreate} from '../branch-create-preview.mjs';
test('branch creation preserves HEAD and staged Work state and never overwrites target',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'branch-create-golden-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),spawn=cp.spawn;
 cp.spawn=(c,a,o)=>spawn(c,a,{...o,env:{...o.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'absent-global')}});syncBuiltinESMExports();t.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
 const run=(...a)=>git(root,a);await run('init');await run('config','user.name','T');await run('config','user.email','t@x');await writeFile(path.join(root,'a'),'base');await run('add','a');await run('commit','-m','base');await writeFile(path.join(root,'a'),'staged');await run('add','a');await writeFile(path.join(root,'a'),'work');
 const head=(await run('rev-parse','HEAD')).toString().trim(),rawHead=await readFile(path.join(root,'.git','HEAD')),index=await readFile(path.join(root,'.git','index')),objects=await readdir(path.join(root,'.git','objects'),{recursive:true}),repo={type:'git',root},snapshot=await prepareBranchCreate(repo,{name:'new/topic'}),request={snapshot,assertAuthorized(){},onStart(){}};
 await applyBranchCreate(repo,request);assert.equal((await run('rev-parse','refs/heads/new/topic')).toString().trim(),head);assert.deepEqual(await readFile(path.join(root,'.git','HEAD')),rawHead);assert.deepEqual(await readFile(path.join(root,'.git','index')),index);assert.equal((await readFile(path.join(root,'a'))).toString(),'work');assert.deepEqual(await readdir(path.join(root,'.git','objects'),{recursive:true}),objects);await assert.rejects(applyBranchCreate(repo,{...request,onStart(){assert.fail('replay must refuse');}}));
});