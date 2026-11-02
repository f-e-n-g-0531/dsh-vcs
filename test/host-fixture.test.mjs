import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {mkdtemp,mkdir,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fixtureEntries,fixtureTree,FIXTURE_LIMITS,addFixtureBudget} from '../scripts/release-host-fixture.mjs';
import {digest} from '../scripts/release-evidence.mjs';
function tar(name,type='0'){const h=Buffer.alloc(512);h.write(name);h.write('00000000001',124);h.write(type,156);return gzipSync(Buffer.concat([h,Buffer.from('a'),Buffer.alloc(511+1024)]));}
test('offline host extraction validates pinned bytes and rejects escapes links and unsafe entries',()=>{const good=tar('node_modules/host/package.json');assert.equal(fixtureEntries(good,digest(good))[0].bytes.toString(),'a');assert.throws(()=>fixtureEntries(good,'f'.repeat(64)));for(const name of ['../x','/x','C:/x','a/../x']){const b=tar(name);assert.throws(()=>fixtureEntries(b,digest(b)));}for(const type of ['1','2','3','x']){const b=tar('file',type);assert.throws(()=>fixtureEntries(b,digest(b)));}});
test('host packing resolves root-local package/store links but refuses external targets and cycles before reading',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-host-tree-')),outside=await mkdtemp(path.join(tmpdir(),'vcs-host-outside-'));
 try{
  await mkdir(path.join(root,'node_modules'),{recursive:true});await mkdir(path.join(root,'store/package'),{recursive:true});await writeFile(path.join(root,'store/package/file.js'),'inside');await writeFile(path.join(root,'package-lock.json'),'{}');
  await symlink(path.join(root,'store/package'),path.join(root,'node_modules/package'),process.platform==='win32'?'junction':'dir');
  const entries=await fixtureTree(root);assert.ok(entries.some(e=>e.name===path.join('node_modules','package','file.js')));assert.ok(entries.some(e=>e.name==='package-lock.json'));
  await writeFile(path.join(outside,'sensitive'),'not read');await symlink(outside,path.join(root,'node_modules/external'),process.platform==='win32'?'junction':'dir');await assert.rejects(fixtureTree(root),/escapes root/);await rm(path.join(root,'node_modules/external'));
  await symlink(path.join(root,'node_modules'),path.join(root,'node_modules/cycle'),process.platform==='win32'?'junction':'dir');await assert.rejects(fixtureTree(root),/cycle/);
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
test('finite fixture budget admits official native members but bounds individual and aggregate materialization',()=>{
 let state={members:0,tarBytes:0};for(const size of [178548224,152357942])state=addFixtureBudget(state,size);assert.equal(state.members,2);
 assert.equal(FIXTURE_LIMITS.memberBytes,256*1024*1024);assert.equal(FIXTURE_LIMITS.archiveBytes,512*1024*1024);assert.equal(FIXTURE_LIMITS.totalBytes,1024*1024*1024);assert.equal(FIXTURE_LIMITS.members,200000);
 assert.throws(()=>addFixtureBudget(state,FIXTURE_LIMITS.memberBytes+1),/member too large/);
 assert.throws(()=>addFixtureBudget({members:FIXTURE_LIMITS.members,tarBytes:0},0),/Too many/);
 assert.throws(()=>addFixtureBudget({members:1,tarBytes:FIXTURE_LIMITS.totalBytes-10240},0),/total budget/);
 assert.throws(()=>addFixtureBudget(state,NaN));assert.throws(()=>addFixtureBudget(state,-1));
});
