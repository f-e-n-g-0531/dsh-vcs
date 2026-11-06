import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const load=(path,require)=>{const module={exports:{}};vm.runInNewContext(transformSync(readFileSync(path,'utf8'),{loader:'jsx',format:'cjs'}).code,{module,exports:module.exports,require,Date,encodeURIComponent,Object,Number,String,Math,Set,Infinity});return module.exports;};
const creation=load('src/BranchCreate.jsx',()=>({})),capture=load('src/TagCreate.jsx',n=>n.includes('BranchCreate')?creation:{}).captureTagCreatePreview;
test('tag UI binds submitted identity and exact message bytes without exposing body',()=>{const submitted={name:'release',tagger:{name:'T',email:'t@x',timestamp:1,timezone:'+0000'},message:'EOF'},v={action:'tag-create',...submitted,ref:'refs/tags/release',objectFormat:'sha1',head:'1'.repeat(40),currentRef:'refs/heads/main',targetTree:'2'.repeat(40),messageBytes:3,object:{oid:'3'.repeat(40)},planId:'4'.repeat(64),token:'5'.repeat(64),expiresAt:Date.now()+59000};assert.ok(capture(v,submitted));for(const patch of [{ref:'refs/heads/release'},{tagger:{...v.tagger,name:'other'}},{messageBytes:4},{object:{oid:v.object.oid,body:'private'}},{head:'0'.repeat(40)},{action:'commit'}])assert.equal(capture({...v,...patch},submitted),null);});
