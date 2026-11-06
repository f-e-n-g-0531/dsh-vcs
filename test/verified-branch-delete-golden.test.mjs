import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createVerifiedBranchDeletePlan} from '../src/verified-branch-delete-plan.mjs';
for(const objectFormat of ['sha1','sha256'])test('raw authenticated commit parents prove deletion direction '+objectFormat,()=>{
 const width=objectFormat==='sha1'?40:64,lf=String.fromCharCode(10);
 const make=parents=>{const body=Buffer.from(['tree '+'1'.repeat(width),...parents.map(p=>'parent '+p),'author T <t@x> 1 +0000','committer T <t@x> 1 +0000','','parent '+('9'.repeat(width))].join(lf)),oid=createHash(objectFormat).update(Buffer.from('commit '+body.length+String.fromCharCode(0))).update(body).digest('hex');return{oid,body};};
 const root=make([]),tip=make([root.oid]),current={ref:'refs/heads/main',oid:tip.oid},target={ref:'refs/heads/topic',oid:root.oid},input={objectFormat,current,target,objects:[tip,root]};
 const p=createVerifiedBranchDeletePlan(input);assert.equal(p.merged,true);assert.deepEqual(p.proof,[tip.oid,root.oid]);assert.throws(()=>createVerifiedBranchDeletePlan({...input,current:{...current,oid:root.oid},target:{...target,oid:tip.oid}}));assert.throws(()=>createVerifiedBranchDeletePlan({...input,objects:[{...tip,parents:[]},root]}));tip.body[5]=0x32;assert.throws(()=>createVerifiedBranchDeletePlan(input));
});