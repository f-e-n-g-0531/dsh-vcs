import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSvnLog} from '../src/svn-log.mjs';
import {parseSvnDetail} from '../src/svn-detail.mjs';
const options={scope:'/',revision:'1'};
test('SVN logs reject non-XML structural whitespace but preserve message characters',()=>{
 for(const text of [' ',' ','﻿','&#160;']){
  assert.throws(()=>parseSvnLog('<log>'+text+'</log>'));
  for(const xml of ['<log>'+text+'<logentry revision="1"/></log>','<log><logentry revision="1">'+text+'</logentry></log>']){
   assert.throws(()=>parseSvnLog(xml));assert.throws(()=>parseSvnDetail(xml,options));
  }
  assert.throws(()=>parseSvnDetail('<log><logentry revision="1"><paths>'+text+'</paths></logentry></log>',options));
 }
 const message='  ﻿';const xml='<log>\n<logentry revision="1">\n<msg>'+message+'</msg>\n</logentry>\n</log>';
 assert.equal(parseSvnLog(xml)[0].message,message);assert.equal(parseSvnDetail(xml,options).message,message);
 assert.deepEqual(parseSvnLog('<log> \n\t</log>'),[]);
});
