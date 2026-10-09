import test from 'node:test';
test('empty names-only SVN properties has no special property',()=>{assert.deepEqual(parseSvnPropertyNames('<?xml version="1.0"?><properties>\n</properties>',{target:'https://example.test/file',allowEmpty:true}),{target:'https://example.test/file',names:[],special:false});});
import assert from 'node:assert/strict';
import {parseSvnPropertyNames} from '../src/svn-property-names.mjs';
const target='https://example.test/repo/file',wrap=body=>'<properties><target path="'+target+'">'+body+'</target></properties>';
test('SVN names-only preflight detects special property and explicit empty target',()=>{
 assert.deepEqual(parseSvnPropertyNames(wrap('<property name="svn:special"/><property name="custom:value"/>'),{target}),{target,names:['svn:special','custom:value'],special:true});
 assert.deepEqual(parseSvnPropertyNames(wrap(''),{target}),{target,names:[],special:false});
});
test('SVN property structure permits only XML whitespace',()=>{
 assert.deepEqual(parseSvnPropertyNames(wrap(' \t\r\n'),{target}).names,[]);
 for(const text of ['\u00a0','\u2003','\ufeff','&#160;']){
  assert.throws(()=>parseSvnPropertyNames(wrap(text),{target}));
  assert.throws(()=>parseSvnPropertyNames(wrap('<property name="x">'+text+'</property>'),{target}));
 }
});
test('SVN property preflight bounds bytes count names and unique targets',()=>{
 const props=Array.from({length:10000},(_,i)=>'<property name="p'+i+'"/>').join('');
 assert.equal(parseSvnPropertyNames(wrap(props),{target}).names.length,10000);
 assert.throws(()=>parseSvnPropertyNames(wrap(props+'<property name="extra"/>'),{target}));
 const padding=' '.repeat(2*1024*1024-Buffer.byteLength(wrap('')));
 assert.deepEqual(parseSvnPropertyNames(wrap(padding),{target}).names,[]);
 assert.throws(()=>parseSvnPropertyNames(wrap(padding+' '),{target}));
 assert.equal(parseSvnPropertyNames(wrap('<property name="'+'x'.repeat(1024)+'"/>'),{target}).names[0].length,1024);
 assert.throws(()=>parseSvnPropertyNames(wrap('<property name="'+'x'.repeat(1025)+'"/>'),{target}));
 assert.throws(()=>parseSvnPropertyNames('<properties><target path="'+target+'"/><target path="'+target+'"/></properties>',{target}));
 for(const invalid of [undefined,'',42,'x'.repeat(32769)])assert.throws(()=>parseSvnPropertyNames(wrap(''),{target:invalid}));
});
test('SVN property preflight rejects ambiguous missing or verbose data',()=>{
 for(const xml of ['<properties/>',wrap('<property name="x"/><property name="x"/>'),wrap('<property name="x">value</property>'),wrap('<property name="x" encoding="base64"/>'),wrap('<property name=""/>'),wrap('<other/>'),wrap('unexpected'),'<!DOCTYPE properties>'+wrap(''),wrap('').replace(target,target+'/other'),wrap('<property name="bad name"/>')])assert.throws(()=>parseSvnPropertyNames(xml,{target}));
});
