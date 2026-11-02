// A real temporary Git worktree through the production authenticated RPC route.
// Isolate fixture machine filter configuration only; never change profile or user config.
import * as fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import assert from 'node:assert/strict';
export async function checkBranchSwitchRpc(ctx,invoke){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'vcs-compat-switch-'))),originalSpawn=cp.spawn,sessionId='branch-switch-fixture';
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'missing-global')};
 const git=(...args)=>cp.execFileSync('git',['-C',root,...args],{env,encoding:'utf8',windowsHide:true,timeout:15000});
 cp.spawn=(command,args,options)=>originalSpawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:env.GIT_CONFIG_GLOBAL}});syncBuiltinESMExports();
 try{
 git('init','-q','-b','main');git('config','user.name','Compat fixture');git('config','user.email','fixture@example.test');git('config','core.autocrlf','false');git('config','commit.gpgsign','false');git('config','core.hooksPath',path.join(root,'.git','empty-hooks'));await fs.mkdir(path.join(root,'.git','empty-hooks'));await fs.writeFile(path.join(root,'file'),'main\n');git('add','.');git('commit','-qm','main');git('branch','target');
 ctx.sessions.set(sessionId,{header:{cwd:root}});const discovered=await invoke('vcs/repositories',{sessionId});assert.equal(discovered.ok,true);const repositoryId=discovered.value.repositories.find(r=>r.type==='git').id,address={sessionId,repositoryId};
 const list=await invoke('vcs/branches',address);assert.equal(list.ok,true);assert.equal(list.value.current.name,'main');const p=await invoke('vcs/branch-switch-prepare',{...address,branch:'target'});assert.equal(p.ok,true,JSON.stringify(p));assert.match(p.value.token,/^[a-f0-9]{64}$/);assert.equal(git('symbolic-ref','--short','HEAD').trim(),'main');
 const switched=await invoke('vcs/branch-switch-confirm',{...address,token:p.value.token});assert.equal(switched.ok,true,JSON.stringify(switched));assert.equal(switched.value.current.name,'target');assert.equal(git('symbolic-ref','--short','HEAD').trim(),'target');assert.equal((await invoke('vcs/branch-switch-confirm',{...address,token:p.value.token})).error.code,'vcs/branch-confirmation-invalid');
 await fs.writeFile(path.join(root,'file'),'dirty\n');const dirty=await invoke('vcs/branch-switch-prepare',{...address,branch:'main'});assert.equal(dirty.error.code,'vcs/branch-dirty');assert.equal(git('symbolic-ref','--short','HEAD').trim(),'target');assert.equal(await fs.readFile(path.join(root,'file'),'utf8'),'dirty\n');
 console.log('Authenticated branch RPC list/prepare/confirm/replay/dirty rejection passed in a real isolated Git worktree. Machine global/system filter config isolated for fixture only.');
 }finally{cp.spawn=originalSpawn;syncBuiltinESMExports();ctx.sessions.delete(sessionId);await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
}
