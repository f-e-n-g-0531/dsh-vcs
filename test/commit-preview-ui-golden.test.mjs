import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transformSync} from 'esbuild';
import vm from 'node:vm';
const code=transformSync(readFileSync('src/CommitPanel.jsx','utf8'),{loader:'jsx',format:'cjs'}).code;
const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:()=>({}),Date,encodeURIComponent,Object,Number,String,Math,Infinity});
const capture=module.exports.captureCommitPreview;
test('literal author committer message binding rejects independently substituted metadata',()=>{
 const author={name:'Author',email:'a@x',timestamp:1,timezone:'+0530'},committer={name:'Committer',email:'c@x',timestamp:2,timezone:'-0330'},submitted={author,committer,message:'literal message'};
 const value={action:'commit',head:'1'.repeat(40),ref:'refs/heads/main',objectFormat:'sha1',indexDigest:'2'.repeat(64),tree:'3'.repeat(40),commit:{oid:'4'.repeat(40)},author,committer,message:submitted.message,token:'5'.repeat(64),expiresAt:Date.now()+59000};
 assert.ok(capture(value,submitted));
 for(const patch of [{author:committer},{committer:author},{message:'other'},{commit:{oid:'4'.repeat(64)}},{ref:'refs/tags/main'},{action:'stage'},{expiresAt:Date.now()-1}])assert.equal(capture({...value,...patch},submitted),null);
});
