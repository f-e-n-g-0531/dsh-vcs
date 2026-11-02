import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {gitCommand} from './helpers/git-command.mjs';
import {detectRepository,listChanges,getComparison,getConflictStages,getCommitDetails,getCommitComparison,getRevisionComparison,getRevisionChanges} from '../vcs.mjs';

async function repository(t) {
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'vcs-consistency-')));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));const g=gitCommand(root);g('init','-q');g('config','user.name','T');g('config','user.email','t@example.test');g('config','core.autocrlf','false');return {root,g,file:path.join(root,'file.txt')};
}
async function onBlobRead(action,read) {
 const original=childProcess.spawn;let mutated=false;
 childProcess.spawn=(command,args,options)=>{const child=original(command,args,options);if(command==='git'&&args.includes('cat-file')&&args.includes('blob')&&!mutated){child.stdout.once('data',()=>{if(!mutated){mutated=true;action();}});}return child;};syncBuiltinESMExports();
 try {const result=await read();assert.equal(mutated,true);return result;}finally{childProcess.spawn=original;syncBuiltinESMExports();}
}

test('ordinary comparisons pin HEAD and Index and reject changes even when MM status/id is unchanged',async t=>{
 const {root,g,file}=await repository(t);await fs.writeFile(file,'BASE');g('add','.');g('commit','-qm','base');const repo=await detectRepository(root),head=g('rev-parse','HEAD').trim();await fs.writeFile(file,'INDEX');g('add','.');await fs.writeFile(file,'WORKING');const tree=g('rev-parse','HEAD^{tree}').trim(),alternate=g('commit-tree',tree,'-p',head,'-m','new-snapshot').trim();await fs.writeFile(path.join(root,'alternate.txt'),'NEW INDEX');const newIndex=g('hash-object','-w','alternate.txt').trim();await fs.rm(path.join(root,'alternate.txt'));
 for(const mode of ['all','staged','unstaged']){
   const id=(await listChanges(repo,mode)).find(row=>row.path==='file.txt').id;const baseline=g('status','--porcelain');
   await assert.rejects(onBlobRead(()=>g('update-ref','HEAD',alternate),()=>getComparison(repo,{mode,id})),{code:'vcs/selection-changed'});assert.equal(g('status','--porcelain'),baseline);g('update-ref','HEAD',head);
   await assert.rejects(onBlobRead(()=>g('update-index','--cacheinfo','100644,'+newIndex+',file.txt'),()=>getComparison(repo,{mode,id})),{code:'vcs/selection-changed'});assert.equal((await listChanges(repo,mode)).find(row=>row.path==='file.txt').id,id);await fs.writeFile(file,'INDEX');g('add','file.txt');await fs.writeFile(file,'WORKING');
 }
 for(const [mode,left,right] of [['all','BASE','WORKING'],['staged','BASE','INDEX'],['unstaged','INDEX','WORKING']]){const id=(await listChanges(repo,mode))[0].id;const result=await getComparison(repo,{mode,id});assert.equal(result.left.text,left);assert.equal(result.right.text,right);assert.equal(result.preview.complete,true);}
 assert.equal(await fs.readFile(file,'utf8'),'WORKING');
});

test('large comparison and explicit conflict stages use the same typed changed-selection contract',async t=>{
 const {root,g,file}=await repository(t);await fs.writeFile(file,'BASE');g('add','.');g('commit','-qm','base');const repo=await detectRepository(root),head=g('rev-parse','HEAD').trim(),tree=g('rev-parse','HEAD^{tree}').trim(),alternate=g('commit-tree',tree,'-p',head,'-m','other').trim();await fs.writeFile(file,'INDEX');g('add','.');await fs.writeFile(file,'WORKING');let id=(await listChanges(repo))[0].id;await assert.rejects(onBlobRead(()=>g('update-ref','HEAD',alternate),()=>getComparison(repo,{id,large:true})),{code:'vcs/selection-changed'});g('reset','--hard',head);
 const branch=g('branch','--show-current').trim();g('checkout','-qb','topic');await fs.writeFile(file,'TOPIC');g('add','.');g('commit','-qm','topic');g('checkout','-q',branch);await fs.writeFile(file,'MAIN');g('add','.');g('commit','-qm','main');try{g('merge','topic');}catch{}
 id=(await listChanges(repo)).find(row=>row.status==='conflicted').id;const diff=await getComparison(repo,{id});assert.equal(diff.left.text,'MAIN');assert.match(diff.right.text,/<<<<<<< /);assert.equal(diff.preview.canLoadLarge,false);const stages=await getConflictStages(repo,{id});assert.deepEqual(stages.stages.map(row=>row.present),[true,true,true]);
 await assert.rejects(onBlobRead(()=>g('add','file.txt'),()=>getConflictStages(repo,{id})),{code:'vcs/selection-changed'});
});

test('unborn additions, symlink blobs and gitlink pointers preserve their special-type semantics',async t=>{
 const {root,g,file}=await repository(t);await fs.writeFile(file,'new');g('add','.');const repo=await detectRepository(root);let id=(await listChanges(repo,'staged'))[0].id;let diff=await getComparison(repo,{mode:'staged',id});assert.equal(diff.left.text,'');assert.equal(diff.right.text,'new');assert.equal(diff.preview.complete,true);g('commit','-qm','base');
 await fs.writeFile(path.join(root,'link-object'),'file.txt');const link=g('hash-object','-w','link-object').trim();await fs.rm(path.join(root,'link-object'));g('update-index','--add','--cacheinfo','120000,'+link+',link');id=(await listChanges(repo,'staged')).find(row=>row.path==='link').id;diff=await getComparison(repo,{mode:'staged',id});assert.equal(diff.right.text,'file.txt');assert.match(diff.notice,/not followed/);assert.equal(diff.preview.canLoadLarge,false);
 const commit=g('rev-parse','HEAD').trim();g('update-index','--add','--cacheinfo','160000,'+commit+',nested');id=(await listChanges(repo,'staged')).find(row=>row.path==='nested').id;diff=await getComparison(repo,{mode:'staged',id});assert.match(diff.right.text,new RegExp(commit));assert.match(diff.notice,/nested.*not loaded/);assert.equal(diff.preview.canLoadLarge,false);
});

test('all comparison APIs expose structural capacities without extending oversized or binary eligibility',async t=>{
 const {root,g,file}=await repository(t);await fs.writeFile(file,'base');g('add','.');g('commit','-qm','base');const base=g('rev-parse','HEAD').trim(),repo=await detectRepository(root);await fs.writeFile(file,('a'.repeat(100)+'\n').repeat(24000));g('add','.');let id=(await listChanges(repo,'staged'))[0].id;let diff=await getComparison(repo,{mode:'staged',id});assert.equal(diff.preview.reason,'size-limit');assert.equal(diff.preview.canLoadLarge,true);g('commit','-qm','large');const target=g('rev-parse','HEAD').trim(),detail=await getCommitDetails(repo,{commit:target});diff=await getCommitComparison(repo,{commit:target,id:detail.changes[0].id});assert.equal(diff.preview.canLoadLarge,true);diff=await getRevisionComparison(repo,{base,target,id:(await getRevisionChanges(repo,{base,target})).changes[0].id});assert.equal(diff.preview.canLoadLarge,true);
 await fs.writeFile(file,Buffer.alloc(8*1024*1024+1,97));id=(await listChanges(repo))[0].id;diff=await getComparison(repo,{id});assert.equal(diff.preview.canLoadLarge,false);await fs.writeFile(file,Buffer.from([0,1,2]));id=(await listChanges(repo))[0].id;diff=await getComparison(repo,{id});assert.equal(diff.preview.reason,'binary');assert.equal(diff.preview.complete,false);assert.equal(diff.preview.canLoadLarge,false);
});
