import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {git} from '../local-command.mjs';
import {createLightweightTag} from '../git-lightweight-tag-create.mjs';
test('lightweight ref creation does not write objects or change dirty workspace',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'tag-ref-golden-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),spawn=cp.spawn;
 cp.spawn=(c,a,o)=>spawn(c,a,{...o,env:{...o.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'absent-global')}});syncBuiltinESMExports();t.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
 const run=(...a)=>git(root,a);await run('init');await run('config','user.name','T');await run('config','user.email','t@x');await writeFile(path.join(root,'a'),'base');await run('add','a');await run('commit','-m','base');
 const head=(await run('rev-parse','HEAD')).toString().trim();
 await writeFile(path.join(root,'a'),'dirty');
 const rawHead=await readFile(path.join(root,'.git','HEAD')),index=await readFile(path.join(root,'.git','index')),objects=await readdir(path.join(root,'.git','objects'),{recursive:true});
 const request={ref:'refs/tags/release/topic',expectedCommitOid:head,objectFormat:'sha1',assertAuthorized(){},onStart(){}};
 await createLightweightTag({type:'git',root},request);assert.equal((await run('rev-parse',request.ref)).toString().trim(),head);assert.deepEqual(await readFile(path.join(root,'.git','HEAD')),rawHead);assert.deepEqual(await readFile(path.join(root,'.git','index')),index);assert.equal((await readFile(path.join(root,'a'))).toString(),'dirty');assert.deepEqual(await readdir(path.join(root,'.git','objects'),{recursive:true}),objects);await assert.rejects(createLightweightTag({type:'git',root},{...request,onStart(){assert.fail('existing ref');}}));
});