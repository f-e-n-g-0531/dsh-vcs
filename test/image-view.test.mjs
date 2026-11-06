import test from 'node:test';
import assert from 'node:assert/strict';
import {IMAGE_ZOOM_PERCENTAGES,imageScaleStyle} from '../src/image-view.mjs';

test('fit retains intrinsic preview sizing without forcing an upscale',()=>{
 const fit={maxWidth:'100%',maxHeight:480,objectFit:'contain'};
 for(const dimensions of [[1,1],[1200,800],[800,1200]]){
  assert.deepEqual(imageScaleStyle(...dimensions),fit);
  assert.deepEqual(imageScaleStyle(...dimensions,'fit'),fit);
 }
});
test('bounded zoom uses the same intrinsic scale on both axes without fitting down',()=>{
 assert.deepEqual(IMAGE_ZOOM_PERCENTAGES,[25,50,100,200]);
 assert.ok(Object.isFrozen(IMAGE_ZOOM_PERCENTAGES));
 for(const percent of IMAGE_ZOOM_PERCENTAGES){
  assert.deepEqual(imageScaleStyle(1200,800,percent),{width:1200*percent/100,height:800*percent/100,maxWidth:'none',maxHeight:'none',objectFit:'contain'});
 }
 assert.equal(imageScaleStyle(1,1,25).width,0.25);
 assert.equal(imageScaleStyle(8192,1,200).width,16384);
 assert.equal(imageScaleStyle(4000,4000,100).height,4000);
});
test('invalid dimensions are rejected in fit and numeric modes',()=>{
 for(const bad of [0,-1,1.5,NaN,Infinity,undefined,null,'100',8193]){
  for(const scale of ['fit',100]){
   assert.throws(()=>imageScaleStyle(bad,10,scale),RangeError);
   assert.throws(()=>imageScaleStyle(10,bad,scale),RangeError);
  }
 }
 assert.throws(()=>imageScaleStyle(4001,4000),RangeError);
});
test('unsupported, nonnumeric and unbounded zoom values are rejected',()=>{
 for(const zoom of [0,-25,24,26,75,201,1000,NaN,Infinity,null,true,'100','FIT',{},[]]){
  assert.throws(()=>imageScaleStyle(100,50,zoom),RangeError);
 }
});
