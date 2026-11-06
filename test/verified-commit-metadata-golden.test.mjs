import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readVerifiedCommitMetadata} from '../src/verified-commit-metadata.mjs';
for(const objectFormat of ['sha1','sha256'])test('literal identity and raw message '+objectFormat,()=>{
 const width=objectFormat==='sha1'?40:64,tree='1'.repeat(width),parent='2'.repeat(width),lf=String.fromCharCode(10),cr=String.fromCharCode(13);
 const message=String.fromCharCode(65279)+'subject'+cr+lf+cr+lf+'author Fake <fake@x> 9 +0000';
 const body=Buffer.from(['tree '+tree,'parent '+parent,'author Author <author@x> 1 +0530','committer Committer <committer@x> 2 -0330','',message].join(lf));
 const oid=createHash(objectFormat).update(Buffer.from('commit '+body.length+String.fromCharCode(0))).update(body).digest('hex');
 const value=readVerifiedCommitMetadata(body,{oid,objectFormat});
 assert.deepEqual(value.author,{name:'Author',email:'author@x',timestamp:1,timezone:'+0530'});
 assert.deepEqual(value.committer,{name:'Committer',email:'committer@x',timestamp:2,timezone:'-0330'});
 assert.equal(value.message,message);assert.equal(value.tree,tree);assert.deepEqual(value.parents,[parent]);
 body.fill(0);assert.equal(value.message,message);
});