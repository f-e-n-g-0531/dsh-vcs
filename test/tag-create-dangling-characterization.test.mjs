import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
test('installed Git refuses dangling symbolic tag target under zero-old no-deref',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'dangling-ref-characterize-'));const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'missing-global')};const git=(...args)=>execFileSync('git',['-C',root,...args],{env,encoding:'utf8'}).trim();
 try{git('init','-q');const tree=git('mktree'),commit=git('-c','user.name=T','-c','user.email=t@x','commit-tree',tree,'-m','fixture');git('symbolic-ref','refs/tags/target','refs/tags/missing');assert.ok(readFileSync(path.join(root,'.git','refs','tags','target'),'utf8').startsWith('ref: '));assert.throws(()=>git('update-ref','--no-deref','refs/tags/target',commit,'0'.repeat(40)),/dangling symref already exists/);assert.equal(readFileSync(path.join(root,'.git','refs','tags','target'),'utf8').trim(),'ref: refs/tags/missing');}finally{rmSync(root,{recursive:true,force:true});}
});