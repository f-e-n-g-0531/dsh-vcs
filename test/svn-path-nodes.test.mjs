import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeSvnPathNodes} from '../src/svn-changes.mjs';
test('SVN XML path nodes reject unknown structure and incomplete copy metadata',()=>{
 const base={'#text':'/scope/file','@_action':'M','@_kind':'file'},options={scope:'/scope',revision:'10'};
 assert.deepEqual(scopeSvnPathNodes([{...base,'@_text-mods':'true','@_prop-mods':'unknown'}],options),[{path:'/scope/file',action:'M',kind:'file'}]);
 for(const node of [null,[],{...base,nested:{}},{...base,'#text':{}},{...base,'@_text-mods':true},{...base,'@_prop-mods':'yes'},{...base,'@_copyfrom-rev':'9'},{...base,'@_copyfrom-path':'/source'}])assert.throws(()=>scopeSvnPathNodes([node],options));
 assert.throws(()=>scopeSvnPathNodes(Array(10001).fill(base),options));
});
