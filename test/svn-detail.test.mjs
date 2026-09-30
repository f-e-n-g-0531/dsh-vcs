import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSvnDetail} from '../src/svn-detail.mjs';
const options={scope:'/scope',revision:'10'};
const wrap=body=>'<log><logentry revision="10"><msg> note </msg>'+body+'</logentry></log>';
test('SVN detail validates revision and scopes all changed paths',()=>{
 const xml=wrap('<paths><path action="A" kind="file" copyfrom-path="/private/a" copyfrom-rev="9">/scope/a</path><path action="M" kind="file">/other/a</path></paths>');
 assert.deepEqual(parseSvnDetail(xml,options),{revision:'10',author:'',date:'',message:' note ',changes:[{path:'/scope/a',action:'A',kind:'file',copySourceOutsideScope:true}]});
 assert.deepEqual(parseSvnDetail(wrap('<paths/>'),options).changes,[]);
});
test('SVN detail rejects wrong revision and malformed nested structures',()=>{
 for(const xml of ['<log/>',wrap('<unknown/>'),wrap('<paths><bad/></paths>'),wrap('<paths><path action="M" kind="file">/other/../bad</path></paths>'),wrap('<paths><path action="M" kind="file">/scope/a</path></paths><paths/>'),'<log><logentry revision="9"/></log>','<!DOCTYPE log>'+wrap(''),'<log><logentry revision="10"/><logentry revision="10"/></log>',wrap('<author><nested/></author>')])assert.throws(()=>parseSvnDetail(xml,options));
});
