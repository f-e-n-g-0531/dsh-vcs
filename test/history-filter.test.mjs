import test from 'node:test';
import assert from 'node:assert/strict';
import {filterCommitFiles,filterLoadedCommits} from '../src/history-filter.mjs';
test('loaded commit search covers author subject SHA and remains literal',()=>{
 const rows=[{id:'abcdef1234',author:'张三',subject:'Fix [parser]'},{id:'987654',author:'Alice',subject:'Other'}];
 assert.equal(filterLoadedCommits(rows,'  '),rows);
 for(const q of ['ABCDEF',' 张三 ','[parser]'])assert.deepEqual(filterLoadedCommits(rows,q),[rows[0]]);
 assert.deepEqual(filterLoadedCommits(rows,'ALICE'),[rows[1]]);
 assert.deepEqual(filterLoadedCommits(rows,'.*'),[]);
 assert.equal(rows.length,2);
});
const files=[{path:'src/New.ts',oldPath:'old/前名.ts'},{path:'docs/readme.md'}];
test('commit file filter matches current and renamed paths without mutating rows',()=>{
 assert.equal(filterCommitFiles(files,'  '),files);
 assert.deepEqual(filterCommitFiles(files,'NEW'),[files[0]]);
 assert.deepEqual(filterCommitFiles(files,' 前名 '),[files[0]]);
 assert.deepEqual(filterCommitFiles(files,'readme'),[files[1]]);
 assert.deepEqual(filterCommitFiles(files,'missing'),[]);
 assert.equal(files.length,2);
});
