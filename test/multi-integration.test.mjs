import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHandler} from '../index.mjs';
function cmd(cwd,name,args){const p=spawnSync(name,args,{cwd,encoding:'utf8',windowsHide:true,timeout:20000,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1'}});assert.equal(p.status,0,p.stderr||p.error?.message);}
test('real mixed workspace routes same-named files to their own authorized repositories',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-vcs-multi-host-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const workspace=path.join(root,'workspace');await fs.mkdir(workspace);
 for(const name of ['client','server']){const dir=path.join(workspace,name);await fs.mkdir(dir);cmd(dir,'git',['init','-b','main']);cmd(dir,'git',['config','user.name','Test']);cmd(dir,'git',['config','user.email','test@example.invalid']);cmd(dir,'git',['config','core.autocrlf','false']);await fs.writeFile(path.join(dir,'same.txt'),name+' base\n');cmd(dir,'git',['add','.']);cmd(dir,'git',['commit','-m','fixture','--no-gpg-sign']);await fs.writeFile(path.join(dir,'same.txt'),name+' working\n');}
 const store=path.join(root,'svn-store'),wc=path.join(workspace,'assets');cmd(root,'svnadmin',['create',store]);cmd(root,'svn',['checkout',pathToFileURL(store).href,wc,'--non-interactive']);await fs.writeFile(path.join(wc,'same.txt'),'svn base\n');cmd(wc,'svn',['add','same.txt']);cmd(wc,'svn',['commit','-m','fixture','--non-interactive']);await fs.writeFile(path.join(wc,'same.txt'),'svn working\n');
 const handler=createHandler({sessions:{get:id=>({header:{cwd:id==='workspace'?workspace:root}})},sessionPersistence:{stat:async()=>null}});
 const scan=await handler('vcs/repositories',{sessionId:'workspace'});assert.equal(scan.ok,true,JSON.stringify(scan));assert.equal(scan.value.repositories.length,3);assert.equal(scan.value.truncated,false);
 const repos=scan.value.repositories;
 for(const repo of repos){const status=await handler('vcs/status',{sessionId:'workspace',repositoryId:repo.id,mode:'all'});assert.equal(status.ok,true,JSON.stringify(status));const entry=status.value.changes.find(c=>c.path==='same.txt');assert.ok(entry);const result=await handler('vcs/compare',{sessionId:'workspace',repositoryId:repo.id,id:entry.id,mode:'all'});assert.equal(result.ok,true,JSON.stringify(result));const name=repo.type==='svn'?'svn':path.basename(repo.root);assert.equal(result.value.left.text,name+' base\n');assert.equal(result.value.right.text,name+' working\n');}
 const denied=await handler('vcs/status',{sessionId:'different-session',repositoryId:repos[0].id,mode:'all'});assert.equal(denied.ok,false);
 const svn= repos.find(r=>r.type==='svn');assert.equal((await handler('vcs/status',{sessionId:'workspace',repositoryId:svn.id,mode:'staged'})).ok,false);
});
