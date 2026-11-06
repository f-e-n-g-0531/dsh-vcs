import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {readLatestCommit} from '../latest-commit.mjs';
for(const count of [19999,20000])test('latest metadata fanout '+count+' preserves inclusive root bound',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'latest-fanout-'))),git=path.join(root,'.git');await fs.mkdir(git);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const readdir=fs.readdir,lstat=fs.lstat,spawn=cp.spawn,sentinel=Error('admitted first child');let children=0,commands=0;
 fs.readdir=async(p,...a)=>p===git?Array.from({length:count},(_,i)=>'entry-'+i):readdir(p,...a);
 fs.lstat=async(p,...a)=>{if(String(p).startsWith(git+path.sep)){children++;throw sentinel;}return lstat(p,...a);};
 cp.spawn=(...a)=>{commands++;return spawn(...a);};syncBuiltinESMExports();t.after(()=>{fs.readdir=readdir;fs.lstat=lstat;cp.spawn=spawn;syncBuiltinESMExports();});
 if(count===19999)await assert.rejects(readLatestCommit({type:'git',root}),e=>e===sentinel);else await assert.rejects(readLatestCommit({type:'git',root}),/Metadata inspection limit exceeded/);
 assert.equal(children,count===19999?1:0);assert.equal(commands,0);
});
