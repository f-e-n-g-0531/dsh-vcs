import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeSvnPathNodes,scopeSvnChanges} from '../src/svn-changes.mjs';
test('SVN modification flags preserve all tri-state combinations and absence',()=>{
 const options={scope:'/scope',revision:'10'};
 for(const text of [undefined,'true','false','unknown'])for(const props of [undefined,'true','false','unknown']){
  const node={'#text':'/scope/file','@_action':'M','@_kind':'file',...(text===undefined?{}:{'@_text-mods':text}),...(props===undefined?{}:{'@_prop-mods':props})};
  const records=scopeSvnPathNodes([node],options);
  assert.equal(Object.hasOwn(records[0],'textModified'),text!==undefined);assert.equal(records[0].textModified,text);
  assert.equal(Object.hasOwn(records[0],'propertiesModified'),props!==undefined);assert.equal(records[0].propertiesModified,props);
  assert.deepEqual(scopeSvnChanges(records,options),records);
 }
 for(const key of ['textModified','propertiesModified'])for(const value of [undefined,null,true,false,0,'yes',{},[]])assert.throws(()=>scopeSvnChanges([{path:'/outside/file',action:'M',kind:'file',[key]:value}],options));
});
test('SVN XML path nodes reject unknown structure and incomplete copy metadata',()=>{
 const base={'#text':'/scope/file','@_action':'M','@_kind':'file'},options={scope:'/scope',revision:'10'};
 assert.deepEqual(scopeSvnPathNodes([{...base,'@_text-mods':'true','@_prop-mods':'unknown'}],options),[{path:'/scope/file',action:'M',kind:'file',textModified:'true',propertiesModified:'unknown'}]);
 for(const node of [null,[],{...base,nested:{}},{...base,'#text':{}},{...base,'@_text-mods':true},{...base,'@_prop-mods':'yes'},{...base,'@_copyfrom-rev':'9'},{...base,'@_copyfrom-path':'/source'}])assert.throws(()=>scopeSvnPathNodes([node],options));
 assert.throws(()=>scopeSvnPathNodes(Array(10001).fill(base),options));
});
