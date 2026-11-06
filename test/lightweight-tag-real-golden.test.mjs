import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createVerifiedLightweightTagPlan} from '../src/lightweight-tag-plan.mjs';
for(const objectFormat of ['sha1','sha256'])test('real Git commit bytes produce lightweight plan without refs '+objectFormat,()=>{const root=mkdtempSync(path.join(tmpdir(),'lightweight-oracle-')),env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'missing')},run=(...a)=>execFileSync('git',['-C',root,...a],{env,stdio:['ignore','pipe','pipe']});try{run('init','-q','--object-format='+objectFormat);const tree=run('mktree').toString().trim(),target=run('-c','user.name=T','-c','user.email=t@x','commit-tree',tree,'-m','fixture').toString().trim(),plan=createVerifiedLightweightTagPlan(run('cat-file','commit',target),{objectFormat,target,name:'release/x'});assert.equal(plan.target,target);assert.equal(plan.targetTree,tree);assert.equal(run('for-each-ref').length,0);assert.equal(Object.hasOwn(plan,'object'),false);}finally{rmSync(root,{recursive:true,force:true});}});
