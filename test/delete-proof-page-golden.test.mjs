import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const module={exports:{}};vm.runInNewContext(transformSync(readFileSync('src/BranchDeletePreview.jsx','utf8'),{loader:'jsx',format:'cjs'}).code,{module,exports:module.exports,require:()=>({})});const page=module.exports.getProofPage;
test('proof paging slices exact first and last hundred without mutating full proof',()=>{const proof=Object.freeze(Array.from({length:10000},(_,i)=>String(i+1).padStart(40,'0'))),first=page(proof,0),last=page(proof,99);assert.equal(first.items.length,100);assert.equal(first.start,0);assert.equal(first.end,100);assert.equal(last.start,9900);assert.equal(last.end,10000);assert.equal(last.items[99],proof[9999]);assert.equal(last.pageCount,100);for(const bad of [-1,100,1.5,NaN,'0'])assert.throws(()=>page(proof,bad),/Invalid proof page/);assert.equal(proof.length,10000);});