import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {git} from '../local-command.mjs';
import {prepareBranchDelete} from '../branch-delete-preview.mjs';
test('merged branch deletion preview authenticates actual ancestor and leaves refs untouched',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'delete-preview-golden-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),spawn=cp.spawn;
 cp.spawn=(c,a,o)=>spawn(c,a,{...o,env:{...o.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'absent-global')}});syncBuiltinESMExports();t.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
 const run=(...a)=>git(root,a);await run('init');await run('config','user.name','T');await run('config','user.email','t@x');await writeFile(path.join(root,'a'),'base');await run('add','a');await run('commit','-m','base');const target=(await run('rev-parse','HEAD')).toString().trim();await run('branch','topic');await writeFile(path.join(root,'a'),'next');await run('add','a');await run('commit','-m','next');
 const head=(await run('rev-parse','HEAD')).toString().trim(),index=await readFile(path.join(root,'.git','index')),before=await readdir(path.join(root,'.git'),{recursive:true});const p=await prepareBranchDelete({type:'git',root},{name:'topic'});assert.equal(p.action,'branch-delete');assert.equal(p.target.oid,target);assert.equal(p.current.oid,head);assert.deepEqual(p.proof,[head,target]);assert.equal(p.merged,true);assert.equal((await run('rev-parse','refs/heads/topic')).toString().trim(),target);assert.deepEqual(await readFile(path.join(root,'.git','index')),index);assert.deepEqual(await readdir(path.join(root,'.git'),{recursive:true}),before);
});