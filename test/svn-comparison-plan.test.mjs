import test from 'node:test';
import assert from 'node:assert/strict';
import {planSvnComparison} from '../src/svn-comparison-plan.mjs';
const options={scope:'/scope',revision:'11',path:'/scope/file'};
const record=action=>({path:options.path,action,kind:'file'});
const side=revision=>({empty:false,path:options.path,revision,pegRevision:revision});
test('SVN comparison plans preserve independent revision identities for all actions',()=>{
 for(const action of ['A','D','M','R'])assert.deepEqual(planSvnComparison([record(action)],options),{path:options.path,action,left:action==='A'?{empty:true}:side('10'),right:action==='D'?{empty:true}:side('11')});
 const copy={...record('A'),copyFromPath:'/private/source',copyFromRevision:'9'};
 const plan=planSvnComparison([copy],options);assert.deepEqual(plan.left,{empty:true});assert.ok(!JSON.stringify(plan).includes('private'));
 assert.deepEqual(planSvnComparison([{...record('A'),copySourceOutsideScope:true}],options),plan);
 for(const marker of [false,'true',null])assert.throws(()=>planSvnComparison([{...record('A'),copySourceOutsideScope:marker}],options));
 assert.throws(()=>planSvnComparison([{...copy,copySourceOutsideScope:true}],options));
 assert.throws(()=>planSvnComparison([{...record('M'),copySourceOutsideScope:true}],options));
 const large=planSvnComparison([record('M')],{...options,revision:'9007199254740993'});assert.equal(large.left.revision,'9007199254740992');
});
test('SVN comparison planning refuses nonmembers out of scope directories and r0',()=>{
 for(const [records,override] of [[[],{}],[[record('M')],{path:'/scope/missing'}],[[record('M')],{scope:'/other'}],[[{...record('M'),kind:'dir'}],{}],[[{...record('M'),kind:'unknown'}],{}],[[record('A')],{revision:'0'}]])assert.throws(()=>planSvnComparison(records,{...options,...override}));
});
