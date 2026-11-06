import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {git} from '../local-command.mjs';
import {prepareAmendPreview,consumeCommitPreview,applyCommitPreview} from '../commit-preview.mjs';
test('same-tree amend preview preserves root topology and cannot authorize normal commit',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'amend-preview-golden-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),spawn=cp.spawn;
 cp.spawn=(c,a,o)=>spawn(c,a,{...o,env:{...o.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'absent-global')}});syncBuiltinESMExports();t.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
 const run=(...a)=>git(root,a);await run('init');await run('config','user.name','Original');await run('config','user.email','original@x');await writeFile(path.join(root,'a'),'base');await run('add','a');await run('commit','-m','old');
 const head=(await run('rev-parse','HEAD')).toString().trim(),tree=(await run('rev-parse','HEAD^{tree}')).toString().trim(),index=await readFile(path.join(root,'.git','index')),objects=await readdir(path.join(root,'.git','objects'),{recursive:true});
 const repo={type:'git',root},s=await prepareAmendPreview(repo,{committer:{name:'New',email:'n@x',timestamp:1,timezone:'+0000'},message:'new message'});
 assert.equal(s.action,'amend');assert.equal(s.head,head);assert.equal(s.tree,tree);assert.deepEqual(s.parents,[]);assert.equal(s.author.name,'Original');assert.notEqual(s.commit.oid,head);
 await assert.rejects(consumeCommitPreview(repo,{snapshot:s,assertAuthorized(){}}));await assert.rejects(applyCommitPreview(repo,{snapshot:s,assertAuthorized(){},onStart(){assert.fail();}}));
 assert.deepEqual(await readFile(path.join(root,'.git','index')),index);assert.deepEqual(await readdir(path.join(root,'.git','objects'),{recursive:true}),objects);assert.equal((await run('rev-parse','HEAD')).toString().trim(),head);
});