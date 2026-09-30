import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSvnPropertyNames} from '../src/svn-property-names.mjs';
const target='https://example.test/repo/file',wrap=body=>'<properties><target path="'+target+'">'+body+'</target></properties>';
test('SVN names-only preflight detects special property and explicit empty target',()=>{
 assert.deepEqual(parseSvnPropertyNames(wrap('<property name="svn:special"/><property name="custom:value"/>'),{target}),{target,names:['svn:special','custom:value'],special:true});
 assert.deepEqual(parseSvnPropertyNames(wrap(''),{target}),{target,names:[],special:false});
});
test('SVN property preflight rejects ambiguous missing or verbose data',()=>{
 for(const xml of ['<properties/>',wrap('<property name="x"/><property name="x"/>'),wrap('<property name="x">value</property>'),wrap('<property name="x" encoding="base64"/>'),wrap('<property name=""/>'),wrap('<other/>'),wrap('unexpected'),'<!DOCTYPE properties>'+wrap(''),wrap('').replace(target,target+'/other'),wrap('<property name="bad name"/>')])assert.throws(()=>parseSvnPropertyNames(xml,{target}));
});
