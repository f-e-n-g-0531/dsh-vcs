import test from 'node:test';import assert from 'node:assert/strict';import {filterSvnHistory} from '../src/svn-history-filter.mjs';
const entry=(revision,date)=>({revision,date,message:'m',author:'a'});
test('SVN history date filter is inclusive and bounded',()=>{
 const rows=[entry(3,'2024-06-15T12:00:00.000000Z'),entry(2,'2023-12-31T23:59:59.000000Z'),entry(1,'2022-01-01T00:00:00.000000Z')];
 assert.deepEqual(filterSvnHistory(rows,{}).map(e=>e.revision),[3,2,1]);
 assert.deepEqual(filterSvnHistory(rows,{since:'2024-01-01'}).map(e=>e.revision),[3]);
 assert.deepEqual(filterSvnHistory(rows,{until:'2023-12-31'}).map(e=>e.revision),[2,1]);
 assert.deepEqual(filterSvnHistory(rows,{since:'2023-01-01',until:'2024-06-15'}).map(e=>e.revision),[3,2]);
 assert.deepEqual(filterSvnHistory(rows,{since:'2024-06-15T00:00:00+08:00'}).map(e=>e.revision),[3]);
 assert.throws(()=>filterSvnHistory(rows,{since:'2 weeks ago'}));
 assert.throws(()=>filterSvnHistory(rows,{until:'@1700000000'}));
 assert.deepEqual(filterSvnHistory([entry(1,'not-a-date')],{since:'2020-01-01'}),[]);
});
