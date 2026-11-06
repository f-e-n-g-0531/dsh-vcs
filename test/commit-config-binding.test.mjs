import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,realpath,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {git} from '../local-command.mjs';
import {prepareCommitPreview,prepareAmendPreview} from '../commit-preview.mjs';
for(const kind of ['commit','amend'])test(kind+' first config read pins git-dir/work-tree and refuses redirect before object reads',async t=>{
 const temp=await mkdtemp(path.join(tmpdir(),'commit-config-bind-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),spawn=cp.spawn,calls=[];let record=false;
 cp.spawn=(c,a,o)=>{if(record&&c==='git')calls.push([...a]);return spawn(c,a,{...o,env:{...o.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'missing-global')}});};syncBuiltinESMExports();t.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
 const run=(...a)=>git(root,a);await run('init');await run('config','user.name','T');await run('config','user.email','t@x');await writeFile(path.join(root,'a'),'base');await run('add','a');await run('commit','-m','base');await run('config','core.worktree','../nonexistent-worktree');const index=await readFile(path.join(root,'.git','index')),head=await readFile(path.join(root,'.git','HEAD'));record=true;
 const person={name:'T',email:'t@x',timestamp:1,timezone:'+0000'};await assert.rejects((kind==='commit'?prepareCommitPreview:prepareAmendPreview)({type:'git',root},{...(kind==='commit'?{author:person}:{}),committer:person,message:'m'}),/Unsupported repository configuration: core.worktree/);
 assert.equal(calls.length,1);assert.ok(calls[0].includes('--git-dir='+path.join(root,'.git')));assert.ok(calls[0].includes('--work-tree='+root));assert.ok(calls[0].includes('--no-includes'));assert.equal(calls[0].includes('cat-file'),false);assert.deepEqual(await readFile(path.join(root,'.git','index')),index);assert.deepEqual(await readFile(path.join(root,'.git','HEAD')),head);
});
