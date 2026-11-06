import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createIndexCommitPlan} from '../src/commit-plan.mjs';
const seal=b=>Buffer.concat([b,createHash('sha1').update(b).digest()]);
function index(stat=0){const h=Buffer.alloc(12);h.write('DIRC');h.writeUInt32BE(2,4);h.writeUInt32BE(1,8);const e=Buffer.alloc(64);e.writeUInt32BE(stat,0);e.writeUInt32BE(0o100644,24);e.fill(0x11,40,60);e.writeUInt16BE(1,60);e.write('a',62);return seal(Buffer.concat([h,e]));}
const identity={name:'T',email:'t@example.invalid',timestamp:1,timezone:'+0000'},options={parent:'2'.repeat(40),parentTree:'3'.repeat(40),author:identity,committer:identity,message:'message without LF'};
test('raw stat changes change plan identity but never tree or commit bytes',()=>{const a=createIndexCommitPlan(index(0),options),b=createIndexCommitPlan(index(1),options);assert.equal(a.tree,b.tree);assert.equal(a.commit.oid,b.commit.oid);assert.deepEqual(a.commit.body,b.commit.body);assert.notEqual(a.indexDigest,b.indexDigest);assert.notEqual(a.id,b.id);assert.equal(a.indexDigest,createHash('sha256').update(index(0)).digest('hex'));});
test('message is content binding and parentTree is noop claim not verified dependency',()=>{const source=index(),p=createIndexCommitPlan(source,options),q=createIndexCommitPlan(source,{...options,message:'different'});assert.notEqual(p.id,q.id);assert.notEqual(p.commit.oid,q.commit.oid);assert.equal(p.tree,q.tree);assert.throws(()=>createIndexCommitPlan(source,{...options,parentTree:p.tree}));const original=Buffer.from(p.commit.body);source.fill(0);assert.deepEqual(p.commit.body,original);});
