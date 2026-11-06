import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {git} from '../local-command.mjs';
import {prepareAmendPreview,applyAmendPreview,applyCommitPreview} from '../commit-preview.mjs';
test('root message-only amend replaces tip and never makes original tip its parent',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'amend-confirm-golden-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),spawn=cp.spawn;
 cp.spawn=(c,a,o)=>spawn(c,a,{...o,env:{...o.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'absent-global')}});syncBuiltinESMExports();t.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
 const run=(...a)=>git(root,a);await run('init');await run('config','user.name','Original');await run('config','user.email','original@x');await writeFile(path.join(root,'a'),'base');await run('add','a');await run('commit','-m','old');
 const old=(await run('rev-parse','HEAD')).toString().trim(),index=await readFile(path.join(root,'.git','index'));await writeFile(path.join(root,'a'),'unstaged');
 const repo={type:'git',root},s=await prepareAmendPreview(repo,{committer:{name:'New',email:'n@x',timestamp:1,timezone:'+0000'},message:'new message'});
 await assert.rejects(applyCommitPreview(repo,{snapshot:s,assertAuthorized(){},onStart(){assert.fail();}}));let starts=0;const value=await applyAmendPreview(repo,{snapshot:s,assertAuthorized(){},onStart(){starts++;}});assert.equal(starts,1);assert.equal(value.head,s.commit.oid);assert.notEqual(value.head,old);
 const body=(await run('cat-file','commit',value.head)).toString();assert.ok(!body.includes('parent '));assert.ok(body.includes('author Original <original@x>'));assert.ok(body.endsWith('new message'));assert.equal((await run('rev-parse','HEAD^{tree}')).toString().trim(),s.previousTree);
 assert.deepEqual(await readFile(path.join(root,'.git','index')),index);assert.equal((await readFile(path.join(root,'a'))).toString(),'unstaged');await assert.rejects(applyAmendPreview(repo,{snapshot:s,assertAuthorized(){},onStart(){assert.fail();}}));
});