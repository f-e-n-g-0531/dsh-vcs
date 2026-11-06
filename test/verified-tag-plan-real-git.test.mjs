import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createVerifiedTagPlan} from '../src/verified-tag-plan.mjs';
for(const objectFormat of ['sha1','sha256'])test('verified tag plan raw target and tag hash actual Git '+objectFormat,()=>{const root=mkdtempSync(path.join(tmpdir(),'tag-plan-oracle-')),env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'missing')},run=(args,input)=>execFileSync('git',['-C',root,...args],{env,input,stdio:['pipe','pipe','pipe']});try{run(['init','-q','--object-format='+objectFormat]);const tree=run(['mktree']).toString().trim(),target=run(['-c','user.name=T','-c','user.email=t@x','commit-tree',tree,'-m','fixture']).toString().trim(),body=run(['cat-file','commit',target]),plan=createVerifiedTagPlan(body,{objectFormat,target,tag:'release/安全',tagger:{name:'T',email:'t@x',timestamp:123,timezone:'+0800'},message:'exact EOF'});assert.equal(plan.targetTree,tree);assert.equal(plan.target,target);assert.equal(run(['hash-object','-t','tag','--stdin'],plan.object.body).toString().trim(),plan.object.oid);assert.equal(run(['for-each-ref']).length,0);}finally{rmSync(root,{recursive:true,force:true});}});