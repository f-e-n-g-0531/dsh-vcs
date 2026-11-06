import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const load=(path,require)=>{const module={exports:{}};vm.runInNewContext(transformSync(readFileSync(path,'utf8'),{loader:'jsx',format:'cjs'}).code,{module,exports:module.exports,require,Date,encodeURIComponent,Object,Number,String,Math,Set,Infinity});return module.exports;};
const creation=load('src/BranchCreate.jsx',()=>({})),capture=load('src/BranchDeletePreview.jsx',name=>name.includes('BranchCreate')?creation:{}).captureBranchDeletePreview;
test('assessment proof direction and no token authority are independently bound',()=>{const current={ref:'refs/heads/main',oid:'1'.repeat(40)},target={ref:'refs/heads/topic',oid:'2'.repeat(40)},v={action:'branch-delete',name:'topic',ref:target.ref,objectFormat:'sha1',current,target,merged:true,proof:[current.oid,target.oid],planId:'3'.repeat(64)},s={name:'topic'};assert.ok(capture(v,s));for(const patch of [{token:'4'.repeat(64)},{proof:[target.oid,current.oid]},{merged:false},{name:'other'},{current:{...current,ref:target.ref}}])assert.equal(capture({...v,...patch},s),null);const same={...v,target:{...target,oid:current.oid},proof:[current.oid]};assert.ok(capture(same,s));});