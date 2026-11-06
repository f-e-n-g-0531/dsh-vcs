import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAmendPlan} from '../src/amend-plan.mjs';
for(const parents of [[],['2'.repeat(40)],['2'.repeat(40),'3'.repeat(40)]])test('amend literal topology preserves original parents '+parents.length,()=>{
 const header=Buffer.alloc(12);header.write('DIRC');header.writeUInt32BE(2,4);const index=Buffer.concat([header,createHash('sha1').update(header).digest()]),lf=String.fromCharCode(10),nul=String.fromCharCode(0);
 const body=Buffer.from(['tree '+'1'.repeat(40),...parents.map(p=>'parent '+p),'author Original <a@x> 1 +0530','committer Old <o@x> 2 +0000','','old message'].join(lf)),head=createHash('sha1').update(Buffer.from('commit '+body.length+nul)).update(body).digest('hex');
 const p=createAmendPlan(index,body,{head,committer:{name:'New',email:'n@x',timestamp:3,timezone:'-0330'},message:'new message'});
 const expected=Buffer.from(['tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',...parents.map(p=>'parent '+p),'author Original <a@x> 1 +0530','committer New <n@x> 3 -0330','','new message'].join(lf));
 assert.deepEqual(p.commit.body,expected);assert.deepEqual(p.parents,parents);assert.ok(!p.parents.includes(head));assert.equal(p.author.name,'Original');
});