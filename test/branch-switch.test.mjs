import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {listLocalBranches,prepareLocalBranchSwitch,switchLocalBranch} from '../branch-switch.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
const LF=String.fromCharCode(10);
const blocked = code => error => error.code === 'vcs/branch-'+code;

// Real Git operations, isolated from machine-wide filter settings; no protocol output mocks.
async function fixture(work) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'vcs-branch-'))),originalSpawn=cp.spawn;
  const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'absent-global')};
  const git=(...args)=>cp.execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,env});
  cp.spawn=(command,args,options)=>originalSpawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:env.GIT_CONFIG_GLOBAL}});syncBuiltinESMExports();
  try {
    git('init','-q','-b','main');git('config','user.name','Switch Test');git('config','user.email','switch@example.test');git('config','core.autocrlf','false');
    await fs.writeFile(path.join(root,'file.txt'),'main'+LF);git('add','.');git('commit','-qm','main');
    git('checkout','-qb','target');await fs.writeFile(path.join(root,'file.txt'),'target'+LF);git('add','.');git('commit','-qm','target');git('checkout','-q','main');
    await work({root,type:'git'},git);
  } finally {cp.spawn=originalSpawn;syncBuiltinESMExports();await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
}
const switchOptions = snapshot => ({snapshot,assertAuthorized:async()=>{},onStart:()=>{}});

test('existing local branches preview immutable identities and switch without hooks or config writes',async()=>fixture(async(repo,git)=>{
  const hook=path.join(repo.root,'.git','hooks','post-checkout'),marker=path.join(repo.root,'.git','hook-ran');
  await fs.writeFile(hook,['#!/bin/sh','touch "'+marker.replaceAll(String.fromCharCode(92),'/')+'"',''].join(LF));await fs.chmod(hook,0o755);
  const config=await fs.readFile(path.join(repo.root,'.git','config'));
  const listed=await listLocalBranches(repo);assert.equal(listed.current.name,'main');assert.deepEqual(listed.branches.map(row=>row.ref),['refs/heads/main','refs/heads/target']);
  const snapshot=await withOperationBudget({},()=>prepareLocalBranchSwitch(repo,{branch:'target'}));assert.equal(snapshot.current.commit,git('rev-parse','main').trim());assert.equal(snapshot.target.commit,git('rev-parse','target').trim());
  let starts=0,auth=0;const result=await withOperationBudget({},()=>switchLocalBranch(repo,{snapshot,onStart:()=>starts++,assertAuthorized:async()=>{auth++;}}));
  assert.equal(result.current.ref,'refs/heads/target');assert.equal(result.current.commit,snapshot.target.commit);assert.equal(starts,1);assert.equal(auth,2);assert.equal(await fs.readFile(path.join(repo.root,'file.txt'),'utf8'),'target'+LF);
  await assert.rejects(fs.stat(marker),{code:'ENOENT'});assert.deepEqual(await fs.readFile(path.join(repo.root,'.git','config')),config);assert.equal(git('status','--porcelain'),'');
}));

test('dirty tracked staged untracked ignored and hidden Index flags block before writes',async()=>fixture(async(repo,git)=>{
  const prepare=()=>prepareLocalBranchSwitch(repo,{branch:'target'}),file=path.join(repo.root,'file.txt');
  await fs.writeFile(file,'modified');await assert.rejects(prepare(),blocked('dirty'));git('add','.');await assert.rejects(prepare(),blocked('dirty'));git('reset','--hard','-q','main');
  await fs.writeFile(path.join(repo.root,'new.txt'),'untracked');await assert.rejects(prepare(),blocked('dirty'));await fs.rm(path.join(repo.root,'new.txt'));
  await fs.writeFile(path.join(repo.root,'.git','info','exclude'),'ignored-file'+LF);await fs.writeFile(path.join(repo.root,'ignored-file'),'preserve');await assert.rejects(prepare(),blocked('dirty'));assert.equal(await fs.readFile(path.join(repo.root,'ignored-file'),'utf8'),'preserve');await fs.rm(path.join(repo.root,'ignored-file'));
  for(const flag of ['assume-unchanged','skip-worktree']) {git('update-index','--'+flag,'file.txt');await assert.rejects(prepare(),blocked('unsupported'));git('update-index','--no-'+flag,'file.txt');}
  assert.equal(git('branch','--show-current').trim(),'main');
}));

test('filters command hooks attributes sparse and operation markers are unsupported before content inspection',async()=>fixture(async(repo,git)=>{
  const prepare=()=>prepareLocalBranchSwitch(repo,{branch:'target'});
  for(const key of ['filter.evil.clean','filter.evil.smudge','filter.evil.process','hook.evil.command','hook.evil.event']) {git('config',key,'do-not-execute');await assert.rejects(prepare(),blocked('unsupported'));git('config','--unset-all',key);}
  for(const marker of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','REBASE_HEAD','BISECT_LOG','index.lock','HEAD.lock','info/sparse-checkout','info/attributes']) {await fs.writeFile(path.join(repo.root,'.git',marker),'present');await assert.rejects(prepare(),blocked('unsupported'));await fs.rm(path.join(repo.root,'.git',marker));}
  for(const marker of ['rebase-merge','rebase-apply','sequencer']) {await fs.mkdir(path.join(repo.root,'.git',marker));await assert.rejects(prepare(),blocked('unsupported'));await fs.rm(path.join(repo.root,'.git',marker),{recursive:true});}
  git('config','core.sparseCheckout','true');await assert.rejects(prepare(),blocked('unsupported'));git('config','--unset','core.sparseCheckout');
  git('checkout','-q','target');await fs.writeFile(path.join(repo.root,'.gitattributes'),'* filter=evil'+LF);git('add','.gitattributes');git('commit','-qm','attributes');git('checkout','-q','main');await assert.rejects(prepare(),blocked('unsupported'));
}));

test('stale previews authorization failure cancellation and ambiguous refs never start mutation',async()=>fixture(async(repo,git)=>{
  const prepare=()=>prepareLocalBranchSwitch(repo,{branch:'target'});let starts=0;
  const snapshot=await prepare();await fs.writeFile(path.join(repo.root,'file.txt'),'dirty');await assert.rejects(switchLocalBranch(repo,{...switchOptions(snapshot),onStart:()=>starts++}),blocked('dirty'));git('reset','--hard','-q','main');
  git('update-ref','refs/heads/target',snapshot.current.commit);await assert.rejects(switchLocalBranch(repo,{...switchOptions(snapshot),onStart:()=>starts++}),blocked('changed'));git('update-ref','refs/heads/target',snapshot.target.commit);
  const authorizationSnapshot=await prepare();
  await assert.rejects(switchLocalBranch(repo,{snapshot:authorizationSnapshot,onStart:()=>starts++,assertAuthorized:async()=>{throw Error('grant revoked');}}),/grant revoked/);
  const controller=new AbortController();controller.abort();await assert.rejects(switchLocalBranch(repo,{...switchOptions(authorizationSnapshot),signal:controller.signal,onStart:()=>starts++}),{name:'AbortError'});assert.equal(starts,0);
  for(const branch of ['-f','refs/heads/target','../target','missing']) await assert.rejects(prepareLocalBranchSwitch(repo,{branch}));
  git('tag','target');await assert.rejects(prepare(),blocked('unsupported'));git('tag','-d','target');
  git('update-ref','-d','refs/heads/target');await assert.rejects(prepare(),blocked('changed'));git('update-ref','refs/heads/target',snapshot.target.commit);
  git('config','core.worktree',repo.root);await assert.rejects(prepare(),blocked('unsupported'));git('config','--unset','core.worktree');
  git('checkout','--detach','-q','main');await assert.rejects(listLocalBranches(repo),blocked('unsupported'));
}));

test('cancellation or post-write authorization loss reports unknown and never rolls back',async()=>fixture(async(repo,git)=>{
  const snapshot=await prepareLocalBranchSwitch(repo,{branch:'target'}),controller=new AbortController();let starts=0;
  await assert.rejects(switchLocalBranch(repo,{snapshot,signal:controller.signal,assertAuthorized:async()=>{},onStart:()=>{starts++;controller.abort();}}),error=>blocked('outcome-unknown')(error)&&error.outcomeUnknown===true);assert.equal(starts,1);assert.equal(git('branch','--show-current').trim(),'main');
  let auth=0;await assert.rejects(switchLocalBranch(repo,{snapshot,onStart:()=>{},assertAuthorized:async()=>{if(++auth===2)throw Error('revoked after write');}}),blocked('outcome-unknown'));assert.equal(git('branch','--show-current').trim(),'target');assert.equal(await fs.readFile(path.join(repo.root,'file.txt'),'utf8'),'target'+LF);
}));

test('redirected Git metadata and new target symlink ancestors are refused',async()=>fixture(async(repo,git)=>{
  const metadata=path.join(repo.root,'.git');
  for(const name of ['HEAD','index','config','objects','refs','logs','info']) {
    const original=path.join(metadata,name),saved=original+'-saved',directory=(await fs.lstat(original)).isDirectory();
    await fs.rename(original,saved);await fs.symlink(saved,original,directory?'junction':'file');
    try {await assert.rejects(prepareLocalBranchSwitch(repo,{branch:'target'}),blocked('unsupported'));}finally{await fs.rm(original,{recursive:directory,force:true});await fs.rename(saved,original);}
  }
  const log=path.join(metadata,'logs','HEAD'),logAlias=path.join(metadata,'hardlink-marker');
  const logBefore=await fs.readFile(log);await fs.link(log,logAlias);
  try {await assert.rejects(prepareLocalBranchSwitch(repo,{branch:'target'}),blocked('unsupported'));assert.deepEqual(await fs.readFile(logAlias),logBefore);}finally{await fs.rm(logAlias);}
  const working=path.join(repo.root,'file.txt'),workingAlias=path.join(metadata,'working-hardlink');await fs.link(working,workingAlias);
  try {await assert.rejects(prepareLocalBranchSwitch(repo,{branch:'target'}),blocked('unsupported'));assert.equal(await fs.readFile(workingAlias,'utf8'),'main'+LF);}finally{await fs.rm(workingAlias);}
  git('checkout','-q','target');await fs.mkdir(path.join(repo.root,'new-dir'));await fs.writeFile(path.join(repo.root,'new-dir','file.txt'),'new');git('add','.');git('commit','-qm','new-directory');git('checkout','-q','main');
  const outside=path.join(metadata,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'preserve'),'untouched');await fs.symlink(outside,path.join(repo.root,'new-dir'),'junction');
  await assert.rejects(prepareLocalBranchSwitch(repo,{branch:'target'}),blocked('unsupported'));assert.equal(await fs.readFile(path.join(outside,'preserve'),'utf8'),'untouched');await assert.rejects(fs.stat(path.join(outside,'file.txt')),{code:'ENOENT'});
}));

test('target in another worktree is not forced and symlink gitlink or external metadata is unsupported',async()=>fixture(async(repo,git)=>{
  const linked=path.join(repo.root,'.git','linked-fixture');git('worktree','add','-q',linked,'target');
  const snapshot=await prepareLocalBranchSwitch(repo,{branch:'target'});await assert.rejects(switchLocalBranch(repo,switchOptions(snapshot)),blocked('outcome-unknown'));assert.equal(git('branch','--show-current').trim(),'main');
  await assert.rejects(listLocalBranches({root:linked,type:'git'}),blocked('unsupported'));git('worktree','remove','--force',linked);
  const metadata=path.join(repo.root,'.git');await fs.rename(metadata,metadata+'-saved');await fs.writeFile(metadata,'gitdir: '+metadata+'-saved'+LF);try{await assert.rejects(listLocalBranches(repo),blocked('unsupported'));}finally{await fs.rm(metadata);await fs.rename(metadata+'-saved',metadata);}
  git('checkout','-q','target');const linkOid=cp.execFileSync('git',['-C',repo.root,'hash-object','-w','--stdin'],{input:'file.txt',encoding:'utf8',windowsHide:true}).trim();
  git('update-index','--add','--cacheinfo','120000',linkOid.trim(),'recorded-link');git('commit','-qm','symlink');git('checkout','-q','main');await assert.rejects(prepareLocalBranchSwitch(repo,{branch:'target'}),blocked('unsupported'));
  git('checkout','-q','target');git('rm','-q','recorded-link');git('update-index','--add','--cacheinfo','160000',git('rev-parse','main').trim(),'module');git('commit','-qm','gitlink');git('checkout','-q','main');await assert.rejects(prepareLocalBranchSwitch(repo,{branch:'target'}),blocked('unsupported'));
}));
