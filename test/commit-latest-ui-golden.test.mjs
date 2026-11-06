import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const code=transformSync(readFileSync('src/CommitPanel.jsx','utf8'),{loader:'jsx',format:'cjs'}).code;
const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:()=>({}),Date,encodeURIComponent,Object,Number,String,Math,Infinity});
const capture=module.exports.captureLatestCommit;
test('latest message read preserves CRLF BOM and rejects byte-count or parent substitution',()=>{
 const message=String.fromCharCode(65279)+'subject'+String.fromCharCode(13,10)+'tail',person={name:'T',email:'t@x',timestamp:1,timezone:'+0000'};
 const value={head:'1'.repeat(40),ref:'refs/heads/main',objectFormat:'sha1',tree:'2'.repeat(40),parents:['3'.repeat(40)],author:person,committer:person,message,messageBytes:Buffer.byteLength(message)};
 assert.equal(capture(value).message,message);for(const patch of [{messageBytes:value.messageBytes-1},{parents:['3'.repeat(40),'3'.repeat(40)]},{objectFormat:'sha256'},{ref:'refs/tags/x'}])assert.equal(capture({...value,...patch}),null);
});