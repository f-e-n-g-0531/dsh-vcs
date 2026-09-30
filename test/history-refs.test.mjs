import test from 'node:test';
import assert from 'node:assert/strict';
import {indexHistoryReferences} from '../src/history-refs.mjs';
test('history refs retain exact OIDs and literal names without mutation',()=>{
 const refs=Object.freeze([Object.freeze({commit:'a'.repeat(40),name:'refs/heads/中文<img>%20'}),Object.freeze({commit:'a'.repeat(64),name:'refs/tags/same'})]);
 const index=indexHistoryReferences(refs);assert.equal(index.size,2);assert.deepEqual(index.get('a'.repeat(40)),{names:['refs/heads/中文<img>%20'],hidden:0});assert.equal(index.has('a'),false);assert.equal(indexHistoryReferences([]).size,0);
});
test('history refs show three names and count remaining references',()=>{
 const refs=Array.from({length:1000},(_,i)=>({commit:'a',name:'refs/tags/'+i}));
 assert.deepEqual(indexHistoryReferences(refs).get('a'),{names:['refs/tags/0','refs/tags/1','refs/tags/2'],hidden:997});assert.equal(refs.length,1000);
});
