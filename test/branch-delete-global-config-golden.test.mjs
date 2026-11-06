import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {git} from '../local-command.mjs';
import {prepareBranchDelete,applyBranchDelete} from '../branch-delete-preview.mjs';
test('branch delete final authorization effective global config change is unknown',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'branch-delete-golden-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),spawn=cp.spawn;
 cp.spawn=(c,a,o)=>spawn(c,a,{...o,env:{...o.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'absent-global')}});syncBuiltinESMExports();t.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
 const run=(...a)=>git(root,a);await run('init');await run('config','user.name','T');await run('config','user.email','t@x');await writeFile(path.join(root,'a'),'base');await run('add','a');await run('commit','-m','base');await run('branch','topic');await writeFile(path.join(root,'a'),'staged');await run('add','a');await writeFile(path.join(root,'a'),'work');
 const head=(await run('rev-parse','HEAD')).toString().trim(),rawHead=await readFile(path.join(root,'.git','HEAD')),index=await readFile(path.join(root,'.git','index')),objects=await readdir(path.join(root,'.git','objects'),{recursive:true});
 const repo={type:'git',root},snapshot=await prepareBranchDelete(repo,{name:'topic'});let changed=false;await assert.rejects(applyBranchDelete(repo,{snapshot,assertAuthorized:async()=>{try{await readFile(path.join(root,'.git','refs','heads','topic'));}catch(e){if(e.code==='ENOENT'){await writeFile(path.join(root,'absent-global'),'[alias]'+String.fromCharCode(10)+'  marker = status'+String.fromCharCode(10));changed=true;}else throw e;}},onStart(){}}),{code:'vcs/branch-delete-outcome-unknown'});assert.equal(changed,true);await assert.rejects(applyBranchDelete(repo,{snapshot,assertAuthorized(){},onStart(){assert.fail('replay');}}));await assert.rejects(readFile(path.join(root,'.git','refs','heads','topic')),{code:'ENOENT'});assert.deepEqual(await readFile(path.join(root,'.git','HEAD')),rawHead);assert.deepEqual(await readFile(path.join(root,'.git','index')),index);assert.equal((await readFile(path.join(root,'a'))).toString(),'work');assert.deepEqual(await readdir(path.join(root,'.git','objects'),{recursive:true}),objects);
});