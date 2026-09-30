import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeSvnChanges} from '../src/svn-changes.mjs';
const options={scope:'/scope',revision:'10'},base={path:'/scope/file',action:'A',kind:'file'};
test('SVN changed paths filter siblings and redact outside copy origins',()=>{
 const records=[base,{...base,path:'/scope-other/file'},{...base,path:'/scope/copy',copyFromPath:'/private/secret',copyFromRevision:'9'},{...base,path:'/scope/local',copyFromPath:'/scope/old',copyFromRevision:'8'}];
 const before=structuredClone(records),result=scopeSvnChanges(records,options);
 assert.deepEqual(result,[base,{path:'/scope/copy',action:'A',kind:'file',copySourceOutsideScope:true},{path:'/scope/local',action:'A',kind:'file',copyFromPath:'/scope/old',copyFromRevision:'8'}]);assert.deepEqual(records,before);assert.ok(!JSON.stringify(result).includes('secret'));
});
test('SVN changed paths enforce r0 and accept exactly ten thousand entries',()=>{
 assert.throws(()=>scopeSvnChanges([base],{scope:'/scope',revision:'0'}));
 assert.throws(()=>scopeSvnChanges([{...base,path:'/outside'}],{scope:'/scope',revision:'0'}));
 const records=Array.from({length:10000},(_,i)=>({...base,path:'/scope/file'+i}));
 const result=scopeSvnChanges(records,options);assert.equal(result.length,10000);assert.deepEqual(result[9999],records[9999]);assert.notEqual(result[0],records[0]);
 assert.throws(()=>scopeSvnChanges([...records,{...base,path:'/scope/overflow'}],options));
});
test('SVN changed paths validate even excluded records before returning data',()=>{
 for(const bad of [{...base,path:'/outside/../secret'},{...base,action:'X'},{...base,kind:'symlink'},{...base,extra:true},{...base,copyFromPath:'/old'},{...base,copyFromRevision:'9'},{...base,copyFromPath:'/old',copyFromRevision:'10'},{...base,action:'M',copyFromPath:'/old',copyFromRevision:'9'}])assert.throws(()=>scopeSvnChanges([bad],options));
 assert.throws(()=>scopeSvnChanges([base,base],options));assert.throws(()=>scopeSvnChanges(Array(10001).fill(base),options));assert.throws(()=>scopeSvnChanges(null,options));
 assert.deepEqual(scopeSvnChanges([],{scope:'/',revision:'0'}),[]);
});
