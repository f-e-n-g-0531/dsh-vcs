import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createIndexCommitPlan} from '../src/commit-plan.mjs';
function source(){const h=Buffer.alloc(12);h.write('DIRC');h.writeUInt32BE(2,4);return Buffer.concat([h,createHash('sha1').update(h).digest()]);}
const ident={name:'T',email:'t@example.invalid',timestamp:1,timezone:'+0000'},args=()=>({parent:'1'.repeat(40),parentTree:'2'.repeat(40),author:{...ident},committer:{...ident},message:'valid'});
test('planner refuses identity accessor rather than producing repeated-read inconsistent identity',()=>{let calls=0;const input=args();Object.defineProperty(input.author,'name',{enumerable:true,get(){calls++;return calls===1?'Good':'Injected';}});assert.throws(()=>createIndexCommitPlan(source(),input));assert.equal(calls,0);});
test('planner refuses late options accessor without evaluating mutation callback',()=>{let calls=0;const input=args(),message=Buffer.from('valid');input.message=message;Object.defineProperty(input,'signal',{enumerable:true,get(){calls++;message.fill(0);return undefined;}});assert.throws(()=>createIndexCommitPlan(source(),input));assert.equal(calls,0);assert.deepEqual(message,Buffer.from('valid'));});
