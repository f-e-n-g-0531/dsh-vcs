import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {discoverRepositories} from '../vcs.mjs';
import {createHandler} from '../index.mjs';
test('shallow discovery includes direct child and never includes grandchild repository',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-shallow-'));
 try{const child=path.join(root,'project'),deep=path.join(root,'container','nested');await mkdir(child,{recursive:true});await mkdir(deep,{recursive:true});for(const dir of [root,child,deep])execFileSync('git',['init',dir],{stdio:'ignore',windowsHide:true});const result=await discoverRepositories(root,{maxDepth:1,shallow:true});assert.ok(result.repositories.some(r=>r.relativePath==='.'));assert.ok(result.repositories.some(r=>r.relativePath==='project'));assert.ok(!result.repositories.some(r=>r.relativePath.includes('nested')));assert.equal(result.truncated,false);}finally{await rm(root,{recursive:true,force:true});}
});
test('host always requests first-level scan',async()=>{let options;const call=createHandler({sessions:{get:()=>({header:{cwd:'/workspace'}})}},{discoverRepositories:async(cwd,o)=>{options=o;return {repositories:[],warnings:[],truncated:false};}});assert.equal((await call('vcs/repositories',{sessionId:'s'})).ok,true);assert.equal(options.maxDepth,1);assert.equal(options.shallow,true);});
test('native dropdown options explicitly pair readable background and foreground',async()=>{const css=await readFile(new URL('../src/style.css',import.meta.url),'utf8');assert.ok(css.includes('option{color:#20242b;background-color:#f1f3f5}'));assert.ok(css.includes('option:checked{color:#ffffff;background-color:#245a9c}'));});
