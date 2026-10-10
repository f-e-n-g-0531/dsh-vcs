import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {detectRepository,listChanges,getComparison} from '../vcs.mjs';
const run=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true});
test('submodule changes report recorded pointer and checkout state without entering the submodule',async()=>{
 const base=await mkdtemp(path.join(os.tmpdir(),'vcs-submodule-')),inner=path.join(base,'inner'),outer=path.join(base,'outer'),sub=path.join(outer,'sub');
 try{
  await mkdir(inner);run(inner,'init','-q');run(inner,'config','user.name','T');run(inner,'config','user.email','t@example.test');await writeFile(path.join(inner,'file.txt'),'one\n');run(inner,'add','.');run(inner,'commit','-qm','one');const first=run(inner,'rev-parse','HEAD').trim();
  await writeFile(path.join(inner,'file.txt'),'two\n');run(inner,'commit','-qam','two');const second=run(inner,'rev-parse','HEAD').trim();
  await mkdir(outer);run(outer,'init','-q');run(outer,'config','user.name','T');run(outer,'config','user.email','t@example.test');await writeFile(path.join(outer,'plain.txt'),'text\n');run(outer,'add','.');run(outer,'commit','-qm','base');
  run(outer,'-c','protocol.file.allow=always','submodule','add','-q',inner,'sub');run(outer,'commit','-qm','add submodule');
  const recorded=run(outer,'ls-tree','HEAD','--','sub').trim().split(/\s+/)[2];assert.equal(recorded,second);run(outer,'remote','add','origin','invalid-transport://never-contact');
  const repo=await detectRepository(outer);assert.equal(run(outer,'status','--porcelain'),'');assert.equal((await listChanges(repo)).length,0);
  run(sub,'checkout','-q',first);
  const indexBefore=run(outer,'ls-files','--stage'),subRefsBefore=run(sub,'show-ref'),subHeadBefore=run(sub,'rev-parse','HEAD').trim();
  const changes=await listChanges(repo);assert.equal(changes.length,1);const entry=changes[0];
  assert.equal(entry.path,'sub');assert.equal(entry.status,'modified');assert.deepEqual(entry.submodule,{recorded,checkout:'initialized'});
  const comparison=await getComparison(repo,{mode:'all',id:entry.id});
  assert.match(comparison.notice,/checkout: initialized/);assert.match(comparison.notice,/not read/);assert.equal(comparison.left.text,'Submodule '+recorded);assert.equal(comparison.right.text,'Submodule '+recorded);
  assert.equal(run(outer,'ls-files','--stage'),indexBefore);assert.equal(run(sub,'show-ref'),subRefsBefore);assert.equal(run(sub,'rev-parse','HEAD').trim(),subHeadBefore);
  await rm(sub,{recursive:true,force:true});
  const missing=(await listChanges(repo))[0];assert.equal(missing.path,'sub');assert.equal(missing.submodule.checkout,'absent');
  await mkdir(sub);run(outer,'update-index','--cacheinfo','160000,'+first+',sub');
  const staged=await listChanges(repo,'staged');assert.equal(staged.length,1);assert.deepEqual(staged[0].submodule,{recorded:first,checkout:'uninitialized'});
  assert.equal((await listChanges(repo,'unstaged')).length,0);
  const stagedComparison=await getComparison(repo,{mode:'staged',id:staged[0].id});assert.match(stagedComparison.notice,/checkout: uninitialized/);assert.equal(stagedComparison.right.text,'Submodule '+first);
  assert.equal(run(outer,'ls-files','--stage').includes(first),true);
 }finally{await rm(base,{recursive:true,force:true});}
});
