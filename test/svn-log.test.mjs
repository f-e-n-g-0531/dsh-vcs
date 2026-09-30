import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSvnLog} from '../src/svn-log.mjs';
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
