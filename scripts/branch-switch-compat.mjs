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
 const snapshot=async()=>({head:git('rev-parse','HEAD'),symbolicHead:git('symbolic-ref','HEAD'),refs:git('show-ref'),status:git('status','--porcelain=v1','--untracked-files=all'),index:await fs.readFile(path.join(root,'.git','index')),file:await fs.readFile(path.join(root,'file'))});
 for(const dirty of [false,true]){
  if(dirty){await fs.writeFile(path.join(root,'file'),'dirty\n');await fs.writeFile(path.join(root,'untracked'),'preserve untracked\n');}
  const before=await snapshot();
  for(const [endpoint,payload] of [['vcs/branches',address],['vcs/branch-switch-prepare',{...address,branch:'target'}],['vcs/branch-switch-confirm',{...address,token:'a'.repeat(64)}]]){
   const result=await invoke(endpoint,payload);assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.error.code,'vcs/not-found',endpoint);assert.match(result.error.message,/removed/i,endpoint);assert.deepEqual(await snapshot(),before,endpoint+' must not modify HEAD, refs, index or worktree');
   if(dirty)assert.equal(await fs.readFile(path.join(root,'untracked'),'utf8'),'preserve untracked\n');
  }
 }
 console.log('Authenticated removed branch RPC list/prepare/confirm rejection passed for clean and dirty isolated Git worktrees; HEAD, refs, index and workspace unchanged. Machine global/system filter config isolated for fixture only.');
 }finally{cp.spawn=originalSpawn;syncBuiltinESMExports();ctx.sessions.delete(sessionId);await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
}
