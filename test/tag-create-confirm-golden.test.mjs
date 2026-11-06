import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,writeFile,readFile,rm,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {git} from '../local-command.mjs';
import {prepareTagCreate,applyTagCreate} from '../tag-create-preview.mjs';
test('branch preview fixes HEAD and creates no target directory ref or objects',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'branch-preview-golden-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),spawn=cp.spawn;
 cp.spawn=(c,a,o)=>spawn(c,a,{...o,env:{...o.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'absent-global')}});syncBuiltinESMExports();t.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
 const run=(...a)=>git(root,a);await run('init');await run('config','user.name','T');await run('config','user.email','t@x');await writeFile(path.join(root,'a'),'base');await run('add','a');await run('commit','-m','base');
 const head=(await run('rev-parse','HEAD')).toString().trim(),before=await readdir(path.join(root,'.git'),{recursive:true}),index=await readFile(path.join(root,'.git','index'));
 const result=await prepareTagCreate({type:'git',root},{name:'release/中文',tagger:{name:'T',email:'t@x',timestamp:1,timezone:'+0000'},message:'exact EOF'});assert.equal(result.action,'tag-create');assert.equal(result.ref,'refs/tags/release/中文');assert.equal(result.message,'exact EOF');assert.equal(Object.hasOwn(result.object,'body'),false);assert.equal(result.head,head);await applyTagCreate({type:'git',root},{snapshot:result,assertAuthorized(){},onStart(){}});assert.equal((await run('rev-parse',result.ref)).toString().trim(),result.object.oid);assert.equal((await run('rev-parse','HEAD')).toString().trim(),head);await assert.rejects(applyTagCreate({type:'git',root},{snapshot:result,assertAuthorized(){},onStart(){assert.fail('replay');}}));assert.deepEqual(await readFile(path.join(root,'.git','index')),index);
});