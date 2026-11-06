import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {prepareCommitPreview,prepareAmendPreview} from '../commit-preview.mjs';
for(const kind of ['commit','amend'])test(kind+' refuses excessive metadata fanout before child stat or Git',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'commit-fanout-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));const git=path.join(root,'.git');await fs.mkdir(git);
 const readdir=fs.readdir,lstat=fs.lstat,spawn=cp.spawn;let childStats=0,commands=0;
 fs.readdir=async(p,...a)=>p===git?Array.from({length:20000},(_,i)=>'entry-'+i):readdir(p,...a);
 fs.lstat=async(p,...a)=>{if(String(p).startsWith(git+path.sep))childStats++;return lstat(p,...a);};
 cp.spawn=(...a)=>{commands++;return spawn(...a);};syncBuiltinESMExports();
 t.after(()=>{fs.readdir=readdir;fs.lstat=lstat;cp.spawn=spawn;syncBuiltinESMExports();});
 const person={name:'T',email:'t@x',timestamp:1,timezone:'+0000'};
 await assert.rejects((kind==='commit'?prepareCommitPreview:prepareAmendPreview)({type:'git',root},{...(kind==='commit'?{author:person}:{}),committer:person,message:'m'}),/Metadata inspection limit exceeded/);
 assert.equal(childStats,0);assert.equal(commands,0);assert.deepEqual(await readdir(git),[]);
});
