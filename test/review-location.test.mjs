import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewLocation,patchReviewLocation,pushReviewLocation} from '../src/review-location.mjs';
test('review coordinates preserve exact path parent line and viewer choices without secrets',()=>{
 const value=reviewLocation({id:'a'.repeat(40),parentIndex:1,path:' 中文 %2F /file.txt',line:42,fileQuery:'file',focused:true,viewer:{wrap:true,sideBySide:false},token:'secret',text:'body',root:'/private'});
 assert.equal(reviewLocation({parentIndex:100,path:'x'.repeat(32768)}).parentIndex,100);assert.equal(reviewLocation({path:'x'.repeat(32768)}).path.length,32768);
 assert.equal(value.parentIndex,1);assert.equal(value.line,42);assert.equal(value.path,' 中文 %2F /file.txt');
 assert.deepEqual(value.viewer,{sideBySide:false,wrap:true,ignoreWhitespace:false,enabled:true});
 assert.equal('token' in value,false);assert.equal('text' in value,false);assert.equal('root' in value,false);
 const patched=patchReviewLocation(value,{viewer:{enabled:false}});
 assert.equal(patched.viewer.wrap,true);assert.equal(patched.viewer.enabled,false);assert.equal(value.viewer.enabled,true);
});
test('side previews keep separate bounded return coordinates',()=>{
 const base=reviewLocation({id:'a'.repeat(40),path:'main.txt',parentIndex:1,source:'tree',tree:{directory:'nested',path:'nested/other.txt',offset:100,query:'other',viewer:{wrap:true}},origin:{commit:'b'.repeat(40),path:'old.txt',line:44}});
 assert.equal(base.path,'main.txt');assert.equal(base.tree.path,'nested/other.txt');assert.equal(base.tree.viewer.wrap,true);assert.equal(base.origin.line,44);
 const stack=pushReviewLocation([],base);assert.equal(stack[0].source,'tree');assert.equal(stack[0].parentIndex,1);
});
test('navigation stack remains bounded and sanitizes invalid coordinates',()=>{
 let stack=[];for(let i=0;i<150;i++)stack=pushReviewLocation(stack,{id:String(i)});
 assert.equal(stack.length,100);assert.equal(stack[0].id,'50');
 const value=reviewLocation({parentIndex:-1,line:0,fileQuery:'x'.repeat(2048),path:'x'.repeat(32769)});
 assert.equal(value.parentIndex,0);assert.equal(value.line,null);assert.equal(value.path,null);assert.equal(value.fileQuery.length,1024);
});
