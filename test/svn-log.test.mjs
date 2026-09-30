import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSvnLog,parseSvnLogPage} from '../src/svn-log.mjs';
test('SVN parsed pages bind XML ordering and lookahead to pinned bounds',()=>{
 const xml=values=>'<log>'+values.map(value=>'<logentry revision="'+value+'"><msg>r'+value+'</msg></logentry>').join('')+'</log>';
 assert.deepEqual(parseSvnLogPage(xml(['9','4','1']),{snapshot:'12',cursor:'9',limit:2}),{snapshot:'12',entries:[{revision:'9',author:'',date:'',message:'r9'},{revision:'4',author:'',date:'',message:'r4'}],nextRevision:'3'});
 assert.deepEqual(parseSvnLogPage('<log/>',{snapshot:'0'}),{snapshot:'0',entries:[],nextRevision:null});
 for(const revisions of [['10'],['4','9'],['9','4','3','1']])assert.throws(()=>parseSvnLogPage(xml(revisions),{snapshot:'12',cursor:'9',limit:2}));
 assert.throws(()=>parseSvnLogPage(xml(['9']),{snapshot:'8',cursor:'9'}));
});
test('SVN log parser preserves large revisions and literal message whitespace',()=>{
 assert.deepEqual(parseSvnLog('<?xml version="1.0"?><log><logentry revision="9007199254740993"><author>007</author><date>date</date><msg>  &lt;img&gt;\n中文  </msg></logentry></log>'),[{revision:'9007199254740993',author:'007',date:'date',message:'  <img>\n中文  '}]);
 assert.deepEqual(parseSvnLog('<log/>'),[]);assert.deepEqual(parseSvnLog('<log><logentry revision="0"/></log>'),[{revision:'0',author:'',date:'',message:''}]);
});
test('SVN summary parser rejects silent loss of unsupported structures',()=>{
 for(const body of ['<error>denied</error>','<logentry revision="0"/>','<paths><path action="M">/file</path></paths>','<msg>a</msg><msg>b</msg>','<author>x</author><author>y</author>','unexpected text','<date><nested/></date>'])assert.throws(()=>parseSvnLog('<log><logentry revision="1">'+body+'</logentry></log>'));
 assert.throws(()=>parseSvnLog('<log><logentry revision="1" extra="yes"/></log>'));
 assert.deepEqual(parseSvnLog('<log>\n  <logentry revision="1">\n    <msg>  unchanged  </msg>\n  </logentry>\n</log>'),[{revision:'1',author:'',date:'',message:'  unchanged  '}]);
});
test('SVN log parser rejects malformed oversized or entity-bearing responses',()=>{
 for(const xml of ['',null,'<log>','<error/>','<log/><error/>','<!DOCTYPE log><log/>','<!DOCTYPE log [<!ENTITY x SYSTEM "file:///secret">]><log/>','<log><unexpected/></log>','<log><logentry revision="HEAD"/></log>','<log><logentry revision="1"><msg><html/></msg></logentry></log>','<log><logentry revision="1"/><logentry revision="1"/></log>','<log>'+Array.from({length:102},(_,i)=>'<logentry revision="'+i+'"/>').join('')+'</log>','<log>'+ ' '.repeat(2*1024*1024)+'</log>'])assert.throws(()=>parseSvnLog(xml));
});
