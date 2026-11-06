import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeGitCommit} from '../src/git-commit-object.mjs';
import {encodeGitTag,parseVerifiedGitTag} from '../src/git-tag-object.mjs';
import {createVerifiedTagPlan} from '../src/verified-tag-plan.mjs';
import {createVerifiedLightweightTagPlan} from '../src/lightweight-tag-plan.mjs';
const person={name:'T',email:'t@x',timestamp:1,timezone:'+0000'};
for(const objectFormat of ['sha1','sha256']){
 const commit=encodeGitCommit({tree:'1'.repeat(objectFormat==='sha1'?40:64),author:person,committer:person,message:'base'},{objectFormat});
 const tag=encodeGitTag({object:commit.oid,tag:'release',tagger:person,message:'EOF'},{objectFormat});
 const consumers={parser:signal=>parseVerifiedGitTag(tag.body,{oid:tag.oid,objectFormat,signal}),annotated:signal=>createVerifiedTagPlan(commit.body,{objectFormat,target:commit.oid,tag:'release',tagger:person,message:'EOF',signal}),lightweight:signal=>createVerifiedLightweightTagPlan(commit.body,{objectFormat,target:commit.oid,name:'release',signal})};
 for(const [name,consume] of Object.entries(consumers))test(objectFormat+' '+name+' preserves arbitrary native cancellation identity without overrides',()=>{
  for(const reason of ['cancelled',42,null,{why:'cancelled'},Error('reason'),Symbol('cancel')]){
   const c=new AbortController();c.abort(reason);let reads=0;for(const key of ['aborted','reason','throwIfAborted'])Object.defineProperty(c.signal,key,{get(){reads++;throw Error('override');}});
   let caught=false;try{consume(c.signal);}catch(error){caught=true;assert.strictEqual(error,reason);}assert.equal(caught,true);assert.equal(reads,0);
  }
 });
 for(const [name,consume] of Object.entries(consumers))test(objectFormat+' '+name+' active intrinsic ignores overrides and cooperative late cancellation preserves reason',()=>{
  const c=new AbortController();for(const key of ['aborted','reason','throwIfAborted'])Object.defineProperty(c.signal,key,{get(){throw Error('override');}});assert.doesNotThrow(()=>consume(c.signal));
  let calls=0;const reason={late:true};let caught=false;try{consume({throwIfAborted(){if(++calls===2)throw reason;}});}catch(error){caught=true;assert.strictEqual(error,reason);}assert.equal(caught,true);assert.equal(calls,2);
 });
}
