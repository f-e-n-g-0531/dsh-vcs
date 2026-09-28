import test from 'node:test';
import assert from 'node:assert/strict';
import {decode,detectRepository,listChanges,getComparison} from '../vcs.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
test('UTF-8 BOM/no BOM and GBK Chinese decode without replacement',()=>{
 for(const bytes of [Buffer.from('中文'),Buffer.concat([Buffer.from([239,187,191]),Buffer.from('中文')])])assert.deepEqual(decode(bytes),{text:'中文',encoding:'UTF-8'});
 assert.deepEqual(decode(Buffer.from([0xd6,0xd0,0xce,0xc4])),{text:'中文',encoding:'GBK'});
 assert.equal(decode(Buffer.from([0x81])).binary,true);assert.equal(decode(Buffer.from([0,1,2])).binary,true);
 assert.equal(decode(Buffer.from([239,187,191,255])).binary,true);
});
test('Git HEAD GBK compares with UTF-8 working content',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-encoding-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:'ignore',windowsHide:true});
 try{git('init');git('config','user.name','Test');git('config','user.email','test@example.invalid');await writeFile(path.join(root,'text.txt'),Buffer.from([0xd6,0xd0,0xce,0xc4]));git('add','.');git('commit','-m','GBK base');await writeFile(path.join(root,'text.txt'),'中文修改');const repo=await detectRepository(root);const [entry]=await listChanges(repo);const result=await getComparison(repo,{id:entry.id});assert.equal(result.left.text,'中文');assert.equal(result.left.encoding,'GBK');assert.equal(result.right.text,'中文修改');assert.equal(result.right.encoding,'UTF-8');assert.ok(!result.binary);}finally{await rm(root,{recursive:true,force:true});}
});
