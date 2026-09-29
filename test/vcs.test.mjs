import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { detectRepository, listChanges, getComparison, listHistory, getCommitDetails, getCommitComparison, getRevisionChanges, getRevisionComparison } from '../vcs.mjs';

function cmd(cwd, name, args, fail = false) {
  const result = spawnSync(name, args, { cwd, windowsHide: true, shell: false, encoding: 'utf8', timeout: 20000, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', LC_ALL: process.platform === 'linux' ? 'C.UTF-8' : 'en_US.UTF-8' } });
  if (!fail) assert.equal(result.status, 0, name + ' ' + args.join(' ') + ': ' + result.stderr);
  return result;
}
async function temp(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-vcs-test-')); t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5 })); return root; }
async function gitRepo(t) { const root = await temp(t); cmd(root, 'git', ['init', '-b', 'main']); cmd(root, 'git', ['config', 'user.name', 'Adapter Test']); cmd(root, 'git', ['config', 'user.email', 'adapter@example.invalid']); cmd(root, 'git', ['config', 'core.autocrlf', 'false']); return root; }
async function write(root, name, value) { await fs.writeFile(path.join(root, name), value); }
function commit(root) { cmd(root, 'git', ['add', '.']); cmd(root, 'git', ['commit', '-m', 'fixture', '--no-gpg-sign']); }
async function compare(repo, name, mode = 'all') { const entries = await listChanges(repo, mode); const entry = entries.find(e => e.path === name); assert.ok(entry, name + ' missing: ' + JSON.stringify(entries)); return getComparison(repo, { mode, id: entry.id }); }

test('divergent revision pairs use direct trees and bind IDs to repository roots',async t=>{
 const root=await gitRepo(t);await write(root,'common.txt','ancestor');commit(root);
 const ancestor=cmd(root,'git',['rev-parse','HEAD']).stdout.trim();
 await write(root,'common.txt','left branch');await write(root,'left.txt','left only');commit(root);
 const base=cmd(root,'git',['rev-parse','HEAD']).stdout.trim();
 cmd(root,'git',['checkout','-b','other',ancestor]);await write(root,'common.txt','right branch');await write(root,'right.txt','right only');commit(root);
 const target=cmd(root,'git',['rev-parse','HEAD']).stdout.trim(),repo=await detectRepository(root);
 assert.equal(cmd(root,'git',['merge-base','--is-ancestor',base,target],true).status,1);
 assert.equal(cmd(root,'git',['merge-base','--is-ancestor',target,base],true).status,1);
 const before=cmd(root,'git',['status','--porcelain']).stdout;
 const list=await getRevisionChanges(repo,{base,target});
 assert.deepEqual(list.changes.map(c=>[c.path,c.status]),[['common.txt','modified'],['left.txt','deleted'],['right.txt','added']]);
 const entry=list.changes.find(c=>c.path==='common.txt');
 const diff=await getRevisionComparison(repo,{base,target,id:entry.id});assert.equal(diff.left.text,'left branch');assert.equal(diff.right.text,'right branch');
 const clone=await temp(t);cmd(clone,'git',['clone','--no-hardlinks',root,'.']);const cloneRepo=await detectRepository(clone);
 const cloneList=await getRevisionChanges(cloneRepo,{base,target});
 assert.notEqual(cloneList.changes.find(c=>c.path==='common.txt').id,entry.id);
 await assert.rejects(getRevisionComparison(cloneRepo,{base,target,id:entry.id}),/revision pair/);
 assert.equal(cmd(root,'git',['status','--porcelain']).stdout,before);assert.equal(cmd(root,'git',['rev-parse','HEAD']).stdout.trim(),target);
});
test('revision file diffs handle rename add delete and reject unrelated IDs',async t=>{
 const root=await gitRepo(t);await write(root,'old.txt','rename content');await write(root,'deleted.txt','removed');commit(root);
 const base=cmd(root,'git',['rev-parse','HEAD']).stdout.trim();
 await fs.rename(path.join(root,'old.txt'),path.join(root,'new.txt'));await fs.unlink(path.join(root,'deleted.txt'));await write(root,'added.txt','new content');commit(root);
 const target=cmd(root,'git',['rev-parse','HEAD']).stdout.trim(),repo=await detectRepository(root);
 await write(root,'new.txt','working only');
 const changes=(await getRevisionChanges(repo,{base,target})).changes;
 for(const [name,left,right] of [['new.txt','rename content','rename content'],['added.txt','','new content'],['deleted.txt','removed','']]){
  const entry=changes.find(c=>c.path===name);assert.ok(entry,name);
  const result=await getRevisionComparison(repo,{base,target,id:entry.id});assert.equal(result.left.text,left);assert.equal(result.right.text,right);
  assert.equal(result.left.label,base);assert.equal(result.right.label,target);
  await assert.rejects(getRevisionComparison(repo,{base:target,target:base,id:entry.id}),/revision pair/);
 }
 assert.equal(changes.find(c=>c.path==='new.txt').oldPath,'old.txt');
 const oldId=(await getCommitDetails(repo,{commit:target})).changes[0].id;
 await assert.rejects(getRevisionComparison(repo,{base,target,id:oldId}),/revision pair/);
 await assert.rejects(getRevisionComparison(repo,{base,target,id:'forged'}),/Invalid revision change/);
 const controller=new AbortController();controller.abort();
 await assert.rejects(getRevisionComparison(repo,{base,target,id:changes[0].id,signal:controller.signal}),{name:'AbortError'});
 const reverse=(await getRevisionChanges(repo,{base:target,target:base})).changes.find(c=>c.path==='added.txt');
 const back=await getRevisionComparison(repo,{base:target,target:base,id:reverse.id});assert.equal(back.left.text,'new content');assert.equal(back.right.text,'');
 assert.equal(await fs.readFile(path.join(root,'new.txt'),'utf8'),'working only');
});
test('local revision change lists bind direction and reject non-commit objects',async t=>{
 const root=await gitRepo(t);await write(root,'one.txt','before');commit(root);
 const base=cmd(root,'git',['rev-parse','HEAD']).stdout.trim();
 await write(root,'one.txt','after');await write(root,'added.txt','new');commit(root);
 const target=cmd(root,'git',['rev-parse','HEAD']).stdout.trim(),repo=await detectRepository(root);
 await write(root,'one.txt','working');const before=cmd(root,'git',['status','--porcelain']).stdout;
 const forward=await getRevisionChanges(repo,{base,target}),reverse=await getRevisionChanges(repo,{base:target,target:base});
 assert.equal(forward.changes.find(c=>c.path==='added.txt').status,'added');
 assert.equal(reverse.changes.find(c=>c.path==='added.txt').status,'deleted');
 assert.notEqual(forward.changes.find(c=>c.path==='one.txt').id,reverse.changes.find(c=>c.path==='one.txt').id);
 assert.deepEqual((await getRevisionChanges(repo,{base,target:base})).changes,[]);
 const blob=cmd(root,'git',['rev-parse',base+':one.txt']).stdout.trim();
 await assert.rejects(getRevisionChanges(repo,{base:blob,target}),/Commit object required/);
 await assert.rejects(getRevisionChanges(repo,{base:'HEAD',target}),/Invalid revision/);
 assert.equal(cmd(root,'git',['status','--porcelain']).stdout,before);
 assert.equal(cmd(root,'git',['rev-parse','HEAD']).stdout.trim(),target);
});
test('historical comparisons preserve nested Unicode and punctuation paths',async t=>{
 const root=await gitRepo(t);
 const names=['nested/中文 空格.txt','nested/[literal].txt','-leading.txt','same.txt','nested/same.txt'];
 await fs.mkdir(path.join(root,'nested'));
 for(const name of names)await write(root,name,'base: '+name);
 commit(root);
 for(const name of names)await write(root,name,'next: '+name);
 commit(root);
 const repo=await detectRepository(root),oid=cmd(root,'git',['rev-parse','HEAD']).stdout.trim();
 const details=await getCommitDetails(repo,{commit:oid});
 assert.equal(details.changes.length,names.length);
 for(const name of names){
  await write(root,name,'not the historical content');
  const entry=details.changes.find(row=>row.path===name);assert.ok(entry,name);
  const result=await getCommitComparison(repo,{commit:oid,id:entry.id});
  assert.equal(result.left.text,'base: '+name);assert.equal(result.right.text,'next: '+name);
 }
});
test('cancelled historical requests stop before probing even nonexistent roots',async()=>{
 const controller=new AbortController();controller.abort();
 const repo={type:'git',root:path.join(os.tmpdir(),'absent-history-root')};
 const commit='a'.repeat(40),id='b'.repeat(64);
 await assert.rejects(listHistory(repo,{signal:controller.signal}),{code:'ABORT_ERR'});
 await assert.rejects(getCommitDetails(repo,{commit,signal:controller.signal}),{name:'AbortError'});
 await assert.rejects(getCommitComparison(repo,{commit,id,signal:controller.signal}),{name:'AbortError'});
});
test('partial clone history never hydrates missing promised blobs',async t=>{
 const source=await gitRepo(t);await write(source,'promised.txt','remote only payload');commit(source);
 cmd(source,'git',['config','uploadpack.allowFilter','true']);
 const target=await temp(t);
 cmd(target,'git',['-c','protocol.file.allow=always','clone','--filter=blob:none','--no-checkout',pathToFileURL(source).href,'.']);
 const commitId=cmd(source,'git',['rev-parse','HEAD']).stdout.trim();
 const oid=cmd(source,'git',['rev-parse','HEAD:promised.txt']).stdout.trim();
 const missing=()=>cmd(target,'git',['-c','protocol.allow=never','rev-list','--objects','--missing=print','HEAD']).stdout;
 assert.ok(missing().includes('?'+oid),'Fixture must actually omit the promised blob');
 const repo=await detectRepository(target),detail=await getCommitDetails(repo,{commit:commitId});
 await assert.rejects(getCommitComparison(repo,{commit:commitId,id:detail.changes[0].id}),{code:'VCS_COMMAND'});
 assert.ok(missing().includes('?'+oid),'Plugin must leave promised object absent');
 // Positive control: the source can supply the blob if explicitly permitted.
 assert.equal(cmd(target,'git',['-c','protocol.file.allow=always','cat-file','blob',oid]).stdout,'remote only payload');
 assert.ok(!missing().includes('?'+oid),'Positive control must hydrate the object');
});

test('history ignores replace refs so snapshots retain original contents',async t=>{
 const root=await gitRepo(t);await write(root,'file.txt','original');commit(root);
 const original=cmd(root,'git',['rev-parse','HEAD']).stdout.trim();
 await write(root,'file.txt','replacement');commit(root);
 const replacement=cmd(root,'git',['rev-parse','HEAD']).stdout.trim();
 cmd(root,'git',['replace',original,replacement]);
 assert.equal(cmd(root,'git',['show',original+':file.txt']).stdout,'replacement');
 const repo=await detectRepository(root),details=await getCommitDetails(repo,{commit:original});
 assert.deepEqual(details.parents,[]);
 const result=await getCommitComparison(repo,{commit:original,id:details.changes[0].id});
 assert.equal(result.right.text,'original');assert.equal(result.left.text,'');
 assert.equal(cmd(root,'git',['replace','-l']).stdout.trim(),original);
});

test('historical special files remain bounded and never follow link or submodule targets',async t=>{
 const root=await gitRepo(t);
 await write(root,'seed.txt','seed');commit(root);
 const seed=cmd(root,'git',['rev-parse','HEAD']).stdout.trim();
 await write(root,'binary.dat',Buffer.from([0,1,2,3]));
 await write(root,'large.txt','x'.repeat(2*1024*1024+1));
 await write(root,'target.txt','/outside/private-file');
 const blob=cmd(root,'git',['hash-object','-w','target.txt']).stdout.trim();
 cmd(root,'git',['add','binary.dat','large.txt']);
 // Index-only objects work on Windows without symlink privileges or a submodule checkout.
 cmd(root,'git',['update-index','--add','--cacheinfo','120000',blob,'link.txt']);
 cmd(root,'git',['update-index','--add','--cacheinfo','160000',seed,'submodule']);
 cmd(root,'git',['commit','--no-gpg-sign','-m','special objects']);
 const repo=await detectRepository(root),commitId=cmd(root,'git',['rev-parse','HEAD']).stdout.trim();
 const before={head:commitId,index:cmd(root,'git',['ls-files','--stage']).stdout,status:cmd(root,'git',['status','--porcelain']).stdout,target:await fs.readFile(path.join(root,'target.txt'),'utf8')};
 const details=await getCommitDetails(repo,{commit:commitId});
 const compare=name=>getCommitComparison(repo,{commit:commitId,id:details.changes.find(row=>row.path===name).id});
 const binary=await compare('binary.dat');assert.equal(binary.binary,true);
 const large=await compare('large.txt');assert.equal(large.right.text,'');assert.match(large.notice,/2 MiB/);
 const link=await compare('link.txt');assert.equal(link.right.text,'/outside/private-file');assert.match(link.notice,/not followed/);
 const submodule=await compare('submodule');assert.equal(submodule.right.text,seed);assert.match(submodule.notice,/not loaded/);
 assert.deepEqual({head:cmd(root,'git',['rev-parse','HEAD']).stdout.trim(),index:cmd(root,'git',['ls-files','--stage']).stdout,status:cmd(root,'git',['status','--porcelain']).stdout,target:await fs.readFile(path.join(root,'target.txt'),'utf8')},before);
});

test('historical comparison reads committed blobs not working files',async t=>{
 const root=await gitRepo(t);await write(root,'a.txt','before');commit(root);const repo=await detectRepository(root);
 const head=()=>cmd(root,'git',['rev-parse','HEAD']).stdout.trim();
 const compare=async()=>{const detail=await getCommitDetails(repo,{commit:head()});return getCommitComparison(repo,{commit:head(),id:detail.changes[0].id});};
 let result=await compare();assert.equal(result.left.text,'');assert.equal(result.right.text,'before');
 cmd(root,'git',['mv','a.txt','b.txt']);commit(root);await write(root,'b.txt','uncommitted');
 result=await compare();assert.equal(result.left.text,'before');assert.equal(result.right.text,'before');assert.equal(result.oldPath,'a.txt');
 const detail=await getCommitDetails(repo,{commit:head()});await assert.rejects(getCommitComparison(repo,{commit:head(),id:'0'.repeat(64)}),/not part/);
 await fs.unlink(path.join(root,'b.txt'));commit(root);result=await compare();assert.equal(result.left.text,'before');assert.equal(result.right.text,'');
 await assert.rejects(getCommitComparison(repo,{commit:head(),id:detail.changes[0].id}),/not part/);
 assert.equal(cmd(root,'git',['status','--porcelain']).stdout,'');
});

test('commit details cover root rename deletion and selected merge parent',async t=>{
 const root=await gitRepo(t);await write(root,'old name.txt','content');commit(root);const repo=await detectRepository(root);
 const head=()=>cmd(root,'git',['rev-parse','HEAD']).stdout.trim();
 const first=await getCommitDetails(repo,{commit:head()});assert.equal(first.parent,null);assert.equal(first.changes[0].status,'added');
 cmd(root,'git',['mv','old name.txt','new name.txt']);commit(root);
 const renamed=await getCommitDetails(repo,{commit:head()});assert.equal(renamed.changes[0].oldPath,'old name.txt');assert.equal(renamed.changes[0].path,'new name.txt');
 cmd(root,'git',['checkout','-b','side']);await write(root,'side.txt','side');commit(root);
 cmd(root,'git',['checkout','main']);await fs.unlink(path.join(root,'new name.txt'));commit(root);
 assert.equal((await getCommitDetails(repo,{commit:head()})).changes[0].status,'deleted');
 cmd(root,'git',['merge','--no-ff','--no-gpg-sign','side','-m','merge']);
 const merged=await getCommitDetails(repo,{commit:head(),parentIndex:1});assert.equal(merged.parents.length,2);assert.equal(merged.parent,merged.parents[1]);assert.equal(merged.changes[0].status,'deleted');
 await assert.rejects(getCommitDetails(repo,{commit:head(),parentIndex:2}),/parent index/);
 await assert.rejects(getCommitDetails(repo,{commit:'--all'}),/commit id/);
 assert.equal(cmd(root,'git',['status','--porcelain']).stdout,'');
});

test('history snapshots paginate without following moving HEAD', async t=>{
 const root=await gitRepo(t), repo=await detectRepository(root);
 assert.deepEqual(await listHistory(repo),{snapshot:null,commits:[],nextOffset:null});
 for(let i=0;i<3;i++){await write(root,'a.txt',String(i));commit(root);}
 const first=await listHistory(repo,{limit:2});assert.equal(first.commits.length,2);assert.equal(first.nextOffset,2);
 await write(root,'a.txt','new');commit(root);
 const second=await listHistory(repo,{snapshot:first.snapshot,offset:2,limit:2});
 assert.equal(second.commits.length,1);assert.deepEqual(second.commits[0].parents,[]);assert.equal(second.nextOffset,null);
 assert.notEqual((await listHistory(repo)).snapshot,first.snapshot);
 await assert.rejects(listHistory(repo,{snapshot:'--all'}),/snapshot/);
 await assert.rejects(listHistory(repo,{offset:-1}),/pagination/);
 await assert.rejects(listHistory(repo,{limit:101}),/pagination/);
 const controller=new AbortController();controller.abort();await assert.rejects(listHistory(repo,{signal:controller.signal}),{code:'ABORT_ERR'});
 assert.equal(cmd(root,'git',['status','--porcelain']).stdout,'');
});

test('detect none, nested repository, unborn HEAD and opaque ID validation', async t => {
  const plain = await temp(t); assert.equal(await detectRepository(plain), null);
  const root = await gitRepo(t); await fs.mkdir(path.join(root, 'nested'));
  const repo = await detectRepository(path.join(root, 'nested')); assert.equal(repo.type, 'git'); assert.equal(repo.root, await fs.realpath(root)); assert.equal(repo.branch, 'main');
  await write(root, 'new.txt', 'new\n');
  assert.equal((await compare(repo, 'new.txt')).right.text, 'new\n'); assert.equal((await listChanges(repo, 'staged')).length, 0);
  cmd(root, 'git', ['add', '.']); const added = await compare(repo, 'new.txt', 'staged'); assert.equal(added.left.text, ''); assert.equal(added.right.text, 'new\n');
  await assert.rejects(getComparison(repo, { id: '../secret' }), /no longer exists/);
  await assert.rejects(listChanges(repo, 'invalid'), /Invalid comparison/);
});

test('Git all, staged, unstaged, rename, delete and stale IDs', async t => {
  const root = await gitRepo(t); await write(root, 'file.txt', 'base\n'); await write(root, 'delete.txt', 'delete me\n'); await write(root, 'old name.txt', 'renamed content\n'); commit(root);
  const repo = await detectRepository(root);
  await write(root, 'file.txt', 'index\n'); cmd(root, 'git', ['add', 'file.txt']); await write(root, 'file.txt', 'working\n');
  for (const [mode, left, right] of [['all','base\n','working\n'],['staged','base\n','index\n'],['unstaged','index\n','working\n']]) { const c = await compare(repo, 'file.txt', mode); assert.equal(c.left.text,left); assert.equal(c.right.text,right); }
  cmd(root, 'git', ['mv', 'old name.txt', '新 & name.txt']); const renamed = await compare(repo, '新 & name.txt'); assert.equal(renamed.oldPath,'old name.txt'); assert.equal(renamed.left.text,renamed.right.text);
  cmd(root, 'git', ['rm', 'delete.txt']); const deleted = await compare(repo,'delete.txt'); assert.equal(deleted.left.text,'delete me\n'); assert.equal(deleted.right.text,'');
  const entry = (await listChanges(repo)).find(e => e.path === 'file.txt'); cmd(root,'git',['restore','--staged','file.txt']); cmd(root,'git',['restore','file.txt']); await assert.rejects(getComparison(repo,{id:entry.id}),/no longer exists/);
});

test('Git binary, UTF-16 BOM, size notices and external diff disabled', async t => {
  const root = await gitRepo(t); await write(root, 'text.txt', 'old'); commit(root); const repo = await detectRepository(root);
  cmd(root,'git',['config','diff.external','this-command-must-never-run']); cmd(root,'git',['config','diff.evil.textconv','this-command-must-never-run']); await write(root,'.gitattributes','*.txt diff=evil\n'); await write(root,'text.txt','new'); assert.equal((await compare(repo,'text.txt')).left.text,'old');
  await write(root,'binary.bin',Buffer.from([1,0,2])); assert.equal((await compare(repo,'binary.bin')).binary,true);
  await write(root,'utf16.txt',Buffer.concat([Buffer.from([255,254]),Buffer.from('中文\n','utf16le')])); assert.equal((await compare(repo,'utf16.txt')).right.text,'中文\n');
  const be = Buffer.from('中文\n','utf16le'); be.swap16(); await write(root,'utf16be.txt',Buffer.concat([Buffer.from([254,255]),be])); assert.equal((await compare(repo,'utf16be.txt')).right.text,'中文\n');
  await write(root,'large.txt',Buffer.alloc(2*1024*1024+1,97)); assert.match((await compare(repo,'large.txt')).notice,/2 MiB/);
  cmd(root,'git',['add','large.txt']); assert.match((await compare(repo,'large.txt','staged')).notice,/2 MiB/);
});

test('Git real merge conflict yields HEAD and working conflict content', async t => {
  const root = await gitRepo(t); await write(root,'conflict.txt','base\n'); commit(root); cmd(root,'git',['checkout','-b','other']); await write(root,'conflict.txt','other\n'); commit(root); cmd(root,'git',['checkout','main']); await write(root,'conflict.txt','main\n'); commit(root); assert.notEqual(cmd(root,'git',['merge','other','--no-edit'],true).status,0);
  const c = await compare(await detectRepository(root),'conflict.txt'); assert.equal(c.status,'conflicted'); assert.equal(c.left.text,'main\n'); assert.match(c.right.text,/<<<<<<< /); assert.match(c.notice,/conflict/i);
});

async function svnRepo(t) {
  const root = await temp(t), repository = path.join(root,'repository'), wc = path.join(root,'wc'); cmd(root,'svnadmin',['create',repository]); cmd(root,'svn',['checkout',pathToFileURL(repository).href,wc,'--non-interactive']); return { root, wc, url:pathToFileURL(repository).href };
}
test('SVN XML, BASE/working, added, deleted, unversioned, directories and properties', async t => {
  const { wc } = await svnRepo(t); await write(wc,'a & 中文.txt','base\n'); await write(wc,'delete.txt','gone\n'); await fs.mkdir(path.join(wc,'dir')); cmd(wc,'svn',['add','a & 中文.txt','delete.txt','dir']); cmd(wc,'svn',['propset','custom:test','base value','a & 中文.txt']); cmd(wc,'svn',['commit','-m','fixture','--non-interactive']);
  const repo = await detectRepository(path.join(wc,'dir')); assert.equal(repo.type,'svn');
  await write(wc,'a & 中文.txt','working\n'); cmd(wc,'svn',['propset','custom:test','working & value','a & 中文.txt']); cmd(wc,'svn',['delete','delete.txt']); await write(wc,'added@file.txt','added\n'); cmd(wc,'svn',['add','added@file.txt@']); await write(wc,'untracked.txt','untracked\n'); cmd(wc,'svn',['propset','custom:dir','yes','dir']);
  const c = await compare(repo,'a & 中文.txt'); assert.equal(c.left.text,'base\n'); assert.equal(c.right.text,'working\n'); assert.equal(c.properties.left['custom:test'],'base value'); assert.equal(c.properties.right['custom:test'],'working & value');
  const added = await compare(repo,'added@file.txt'); assert.equal(added.left.text,''); assert.equal(added.right.text,'added\n');
  const deleted = await compare(repo,'delete.txt'); assert.equal(deleted.left.text,'gone\n'); assert.equal(deleted.right.text,'');
  assert.equal((await compare(repo,'untracked.txt')).right.text,'untracked\n'); assert.match((await compare(repo,'dir')).notice,/Directory/);
  await assert.rejects(listChanges(repo,'staged'),/SVN supports/); await assert.rejects(getComparison(repo,{id:'../../secret'}),/no longer exists/);
});

test('SVN real conflict, missing file, property-only change and replacement', async t => {
  const { root, wc, url } = await svnRepo(t); await write(wc,'conflict.txt','base\n'); await write(wc,'missing.txt','missing base\n'); await write(wc,'prop.txt','same\n'); await write(wc,'replace.txt','original\n'); cmd(wc,'svn',['add','.','--force']); cmd(wc,'svn',['commit','-m','fixture']);
  const other = path.join(root,'other'); cmd(root,'svn',['checkout',url,other]); await write(other,'conflict.txt','remote\n'); cmd(other,'svn',['commit','-m','remote']); await write(wc,'conflict.txt','local\n'); cmd(wc,'svn',['update','--accept','postpone']);
  await fs.unlink(path.join(wc,'missing.txt')); cmd(wc,'svn',['propset','custom:space','  preserved  ','prop.txt']); cmd(wc,'svn',['delete','replace.txt']); await write(wc,'replace.txt','replacement\n'); cmd(wc,'svn',['add','replace.txt']);
  const repo = await detectRepository(wc); const conflict = await compare(repo,'conflict.txt'); assert.equal(conflict.status,'conflicted'); assert.equal(conflict.left.text,'remote\n'); assert.match(conflict.right.text,/<<<<<<< /);
  const missing = await compare(repo,'missing.txt'); assert.equal(missing.left.text,'missing base\n'); assert.equal(missing.right.text,'');
  const prop = await compare(repo,'prop.txt'); assert.equal(prop.left.text,prop.right.text); assert.equal(prop.properties.right['custom:space'],'  preserved  ');
  const replacement = await compare(repo,'replace.txt'); assert.equal(replacement.left.text,''); assert.equal(replacement.right.text,'replacement\n'); assert.match(replacement.notice,/BASE is unavailable/);
});

test('Git and SVN reject selected symlink/junction escapes', async t => {
  for (const type of ['git','svn']) {
    const root = type === 'git' ? await gitRepo(t) : (await svnRepo(t)).wc;
    await fs.mkdir(path.join(root,'folder')); await write(root,'folder/file.txt','inside');
    if (type === 'git') commit(root); else { cmd(root,'svn',['add','folder']); cmd(root,'svn',['commit','-m','fixture']); }
    const outside = await temp(t); await write(outside,'file.txt','secret'); await fs.rm(path.join(root,'folder'),{recursive:true});
    try { await fs.symlink(outside,path.join(root,'folder'),process.platform === 'win32' ? 'junction' : 'dir'); } catch (e) { if (['EPERM','EACCES'].includes(e.code)) { t.skip('Symlink privilege unavailable'); return; } throw e; }
    const repo = await detectRepository(root), entries = await listChanges(repo); assert.ok(entries.length);
    for (const entry of entries.filter(e=>e.path === 'folder' || e.path.startsWith('folder/'))) await assert.rejects(getComparison(repo,{id:entry.id}),/escapes repository/);
  }
});
