import test from 'node:test';
import assert from 'node:assert/strict';
import {filterTreeEntries} from '../src/tree-filter.mjs';
test('tree filtering stays shallow literal and immutable with directories first',()=>{
 const entries=[{path:'a',type:'blob'},{path:'z',type:'tree'},{path:'z/File[1].txt',type:'blob'},{path:'z/中文',type:'blob'},{path:'z/deeper',type:'tree'},{path:'z/deeper/hidden',type:'blob'},{path:'zz/foreign',type:'blob'}];
 const before=JSON.stringify(entries);
 assert.deepEqual(filterTreeEntries(entries).map(e=>e.path),['z','a']);
 assert.deepEqual(filterTreeEntries(entries,'z').map(e=>e.path),['z/deeper','z/File[1].txt','z/中文']);
 assert.deepEqual(filterTreeEntries(entries,'z','FILE[1]').map(e=>e.path),['z/File[1].txt']);
 assert.equal(filterTreeEntries(entries,'z','hidden').length,0);
 assert.equal(filterTreeEntries(entries,'z','中文').length,1);
 assert.equal(JSON.stringify(entries),before);
});
