import test from 'node:test';
import assert from 'node:assert/strict';
import {selectExactHistoryPath} from '../src/history-filter.mjs';

test('history navigation selects only one exact current path using opaque id',()=>{
 const files=[{id:'opaque-1',path:'Dir/中文.txt',oldPath:'old.txt'},{id:'opaque-2',path:'deleted.txt',status:'D'}];
 assert.equal(selectExactHistoryPath(files,'Dir/中文.txt'),'opaque-1');
 assert.equal(selectExactHistoryPath(files,'deleted.txt'),'opaque-2');
 for(const path of ['old.txt','dir/中文.txt',' Dir/中文.txt','Dir/中文.txt ','missing','',null,undefined])assert.equal(selectExactHistoryPath(files,path),null);
 assert.equal(selectExactHistoryPath([{id:'spaced',path:' x '}],' x '),'spaced');
 assert.equal(selectExactHistoryPath([], 'file'),null);
 assert.deepEqual(files[0],{id:'opaque-1',path:'Dir/中文.txt',oldPath:'old.txt'});
});
test('history navigation refuses ambiguous paths and missing opaque ids',()=>{
 assert.equal(selectExactHistoryPath([{id:'one',path:'x'},{id:'two',path:'x'}],'x'),null);
 assert.equal(selectExactHistoryPath([{id:'one',path:'x'},{id:'one',path:'x'}],'x'),null);
 for(const id of ['',null,undefined,4])assert.equal(selectExactHistoryPath([{id,path:'x'}],'x'),null);
});
