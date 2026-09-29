import test from 'node:test';
import assert from 'node:assert/strict';
import {parseBlame} from '../git-history.mjs';
const record=(line=1,hash='a'.repeat(40),text='text')=>hash+' 1 '+line+' 1\nauthor 作者\nauthor-time 123\nauthor-tz +0800\nsummary change\nfilename "quoted path"\n	'+text+'\n';
test('blame parses SHA1 SHA256 Unicode empty and tabbed source lines',()=>{
 for(const hash of ['a'.repeat(40),'b'.repeat(64)]){
 const rows=parseBlame(record(8,hash,'')+record(9,hash,'	code'));
 assert.equal(rows[0].commit,hash);assert.equal(rows[0].author,'作者');assert.equal(rows[0].line,8);assert.equal(rows[0].text,'');assert.equal(rows[1].text,'	code');assert.equal(rows[0].authorTime,123);
 }
 assert.deepEqual(parseBlame(''),[]);
});
test('blame rejects malformed framing metadata and bounded output',()=>{
 for(const text of [record().slice(0,-1),record().replace('author-time 123\n',''),record().replace('author 作者','author x\nauthor y'),record().replace('author-time 123','author-time NaN'),record().replace(' 1 1 1',' 0 1 1'),record()+record(3),record(1,'bad')])assert.throws(()=>parseBlame(text));
 assert.throws(()=>parseBlame(record()+record(2),1),/limit/);assert.throws(()=>parseBlame('',501),/limit/);assert.throws(()=>parseBlame('x'.repeat(2*1024*1024+1)),/size/);
});
