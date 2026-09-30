import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSvnRevision,previousSvnRevision,svnRevisionPage} from '../src/svn-revision.mjs';
test('SVN revisions remain canonical and exact beyond Number precision',()=>{
 assert.equal(parseSvnRevision('9007199254740993'),9007199254740993n);assert.equal(previousSvnRevision('9007199254740993'),'9007199254740992');
 assert.equal(previousSvnRevision('0'),null);assert.equal(previousSvnRevision('1'),'0');
 assert.equal(parseSvnRevision('9223372036854775807'),9223372036854775807n);
 for(const value of [0,1,null,undefined,'','01','-1','+1','HEAD','BASE','{2026-01-01}','1:2','1e3',' 1','1\n','9223372036854775808','9'.repeat(10000)])assert.throws(()=>parseSvnRevision(value));
});
test('SVN page cursors follow last visible revision rather than numeric offset',()=>{
 const input=['100','71','20'];assert.deepEqual(svnRevisionPage(input,{snapshot:'100',limit:2}),{snapshot:'100',revisions:['100','71'],nextRevision:'70'});
 assert.deepEqual(input,['100','71','20']);assert.deepEqual(svnRevisionPage(['20','0'],{snapshot:'100',cursor:'70',limit:2}),{snapshot:'100',revisions:['20','0'],nextRevision:null});
 assert.equal(svnRevisionPage([],{snapshot:'0'}).nextRevision,null);
 assert.equal(svnRevisionPage(['9007199254740993','8'],{snapshot:'9007199254740993',limit:1}).nextRevision,'9007199254740992');
});
test('SVN pages reject duplicate ascending out of range and unbounded results',()=>{
 for(const revisions of [['9','9'],['8','9'],['11'],['0','1'],['3','2','1']])assert.throws(()=>svnRevisionPage(revisions,{snapshot:'10',limit:1}));
 for(const options of [{cursor:'11'},{limit:0},{limit:101},{limit:1.5},{cursor:'HEAD'}])assert.throws(()=>svnRevisionPage([],{snapshot:'10',...options}));
 assert.throws(()=>svnRevisionPage(null,{snapshot:'10'}));
});
