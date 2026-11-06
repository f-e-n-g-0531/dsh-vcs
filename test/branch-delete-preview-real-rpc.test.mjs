import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {git} from '../local-command.mjs';
import {createHandler} from '../index.mjs';
test('actual Host deletion preview returns no token and leaves branch untouched',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'branch-rpc-golden-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),spawn=cp.spawn;
 cp.spawn=(c,a,o)=>spawn(c,a,{...o,env:{...o.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'absent-global')}});syncBuiltinESMExports();t.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
 const run=(...a)=>git(root,a);await run('init');await run('config','user.name','T');await run('config','user.email','t@x');await writeFile(path.join(root,'a'),'base');await run('add','a');await run('commit','-m','base');const head=(await run('rev-parse','HEAD')).toString().trim(),rawHead=await readFile(path.join(root,'.git','HEAD')),index=await readFile(path.join(root,'.git','index'));await run('branch','topic');await writeFile(path.join(root,'a'),'work');
 const handle=createHandler({sessions:{get:()=>({header:{cwd:root}})}});t.after(()=>handle.dispose());const call=async(e,p)=>{const response=await handle(e,{sessionId:'s',...p});assert.equal(response.ok,true,JSON.stringify({e,response}));return response.value;};
 const found=await call('vcs/repositories',{}),repositoryId=found.repositories.find(r=>r.type==='git').id,preview=await call('vcs/branch-delete-preview',{repositoryId,name:'topic'});assert.equal(preview.target.oid,head);assert.equal(preview.merged,true);assert.equal(Object.hasOwn(preview,'token'),false);assert.equal((await handle('vcs/branch-delete-confirm',{sessionId:'s',repositoryId,token:'1'.repeat(64)})).ok,false);
 assert.equal((await run('rev-parse','refs/heads/topic')).toString().trim(),head);assert.deepEqual(await readFile(path.join(root,'.git','HEAD')),rawHead);assert.deepEqual(await readFile(path.join(root,'.git','index')),index);assert.equal((await readFile(path.join(root,'a'))).toString(),'work');
});