import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {detectRepository,listChanges} from '../vcs.mjs';
const git=(cwd,...args)=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',windowsHide:true});
const init=root=>{git(root,'init','-q');git(root,'config','user.name','T');git(root,'config','user.email','t@example.test');};
test('submodule metadata uses raw exact Unicode and space paths across rename records',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vcs-sub-path-')),names=['模块','前缀模块','space module'];
 try{init(root);for(const name of names){const dir=path.join(root,name);await mkdir(dir);init(dir);await writeFile(path.join(dir,'f'),'base');git(dir,'add','.');git(dir,'commit','-qm','base');}git(root,'add','.');git(root,'commit','-qm','gitlinks');
 for(const [i,name] of names.entries()){const dir=path.join(root,name);if(i===0){await writeFile(path.join(dir,'f'),'next');git(dir,'commit','-qam','next');}if(i===1)await writeFile(path.join(dir,'f'),'dirty');if(i===2)await writeFile(path.join(dir,'extra'),'untracked');}
 const repo=await detectRepository(root),before=git(root,'ls-files','--stage','-z');
 for(const quote of ['true','false']){git(root,'config','core.quotepath',quote);const rows=await listChanges(repo);for(const [i,name] of names.entries()){const sub=rows.find(r=>r.path===name)?.submodule;assert.ok(sub,name);assert.deepEqual([sub.pointerMoved,sub.dirty,sub.untracked],[i===0,i===1,i===2]);}}
 assert.equal(git(root,'ls-files','--stage','-z'),before);
 git(root,'mv','space module','重命名 module');const renamed=(await listChanges(repo)).find(r=>r.path==='重命名 module');assert.equal(renamed.submodule.untracked,true);assert.equal(renamed.submodule.dirty,false);assert.equal(renamed.submodule.pointerMoved,false);
 assert.ok(before.includes('模块'));
 }finally{await rm(root,{recursive:true,force:true,maxRetries:5});}
});
