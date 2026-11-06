import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const load=(file,require)=>{const module={exports:{}};vm.runInNewContext(transformSync(readFileSync(file,'utf8'),{loader:'jsx',format:'cjs'}).code,{module,exports:module.exports,require,Date,encodeURIComponent,Object,Number,String,Math,Set,Infinity});return module.exports;};
const branch=load('src/BranchCreate.jsx',()=>({})),capture=load('src/LightweightTagCreate.jsx',n=>n.includes('BranchCreate')?branch:{}).captureLightweightTagCreatePreview;
test('lightweight UI accepts exact server action and rejects annotated metadata',()=>{const value={action:'lightweight-tag-create',name:'release',ref:'refs/tags/release',head:'1'.repeat(40),currentRef:'refs/heads/main',objectFormat:'sha1',targetTree:'2'.repeat(40),planId:'3'.repeat(64),token:'4'.repeat(64),expiresAt:Date.now()+59000};assert.ok(capture(value,{name:'release'}));for(const patch of [{action:'tag-create'},{object:{oid:'5'.repeat(40)}},{ref:'refs/heads/release'},{targetTree:'0'.repeat(40)}])assert.equal(capture({...value,...patch},{name:'release'}),null);});
