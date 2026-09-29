import test from 'node:test';
import assert from 'node:assert/strict';
import {filterCommitFiles} from '../src/history-filter.mjs';
const files=[{path:'src/New.ts',oldPath:'old/前名.ts'},{path:'docs/readme.md'}];
test('commit file filter matches current and renamed paths without mutating rows',()=>{
 assert.equal(filterCommitFiles(files,'  '),files);
 assert.deepEqual(filterCommitFiles(files,'NEW'),[files[0]]);
 assert.deepEqual(filterCommitFiles(files,' 前名 '),[files[0]]);
 assert.deepEqual(filterCommitFiles(files,'readme'),[files[1]]);
 assert.deepEqual(filterCommitFiles(files,'missing'),[]);
 assert.equal(files.length,2);
});
