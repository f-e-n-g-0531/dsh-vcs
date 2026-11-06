import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const code=transformSync(readFileSync('src/AmendPanel.jsx','utf8'),{loader:'jsx',format:'cjs'}).code;
const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:()=>({}),Date,encodeURIComponent,Object,Number,String,Math,Infinity});
const capture=module.exports.captureAmendPreview;
test('amend UI binds explicit committer and message while validating preserved topology',()=>{
 const person={name:'T',email:'t@x',timestamp:1,timezone:'+0000'},submitted={committer:person,message:'m'},value={action:'amend',head:'1'.repeat(40),ref:'refs/heads/main',objectFormat:'sha1',indexDigest:'2'.repeat(64),previousTree:'3'.repeat(40),parents:['4'.repeat(40)],tree:'5'.repeat(40),commit:{oid:'6'.repeat(40)},author:{...person,name:'Original'},committer:person,message:'m',token:'7'.repeat(64),expiresAt:Date.now()+59000};
 assert.ok(capture(value,submitted));for(const patch of [{action:'commit'},{previousTree:'3'.repeat(64)},{parents:['4'.repeat(40),'4'.repeat(40)]},{committer:{...person,name:'Other'}},{message:'other'}])assert.equal(capture({...value,...patch},submitted),null);
});