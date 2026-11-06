import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const code=transformSync(readFileSync('src/BranchCreate.jsx','utf8'),{loader:'jsx',format:'cjs'}).code;
const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:()=>({}),Date,encodeURIComponent,Object,Number,String,Math,Infinity});
const capture=module.exports.captureBranchCreatePreview;
test('branch preview binds exact short name ref and server fixed HEAD target',()=>{
 const submitted={name:'feature/topic'},value={action:'branch-create',name:submitted.name,ref:'refs/heads/'+submitted.name,target:{oid:'1'.repeat(40)},head:'1'.repeat(40),currentRef:'refs/heads/main',objectFormat:'sha1',token:'2'.repeat(64),expiresAt:Date.now()+59000};
 assert.ok(capture(value,submitted));for(const patch of [{name:'other'},{ref:'refs/heads/other'},{target:{oid:'3'.repeat(40)}},{head:'1'.repeat(64)},{action:'branch-switch'},{currentRef:'refs/tags/x'}])assert.equal(capture({...value,...patch},submitted),null);
});