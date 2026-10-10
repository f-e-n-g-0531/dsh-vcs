import test from 'node:test';import assert from 'node:assert/strict';
import {prepareSimpleWebp,prepareRaster} from '../image-preview.mjs';
function image(width=2,height=3,version=0){const buffer=Buffer.alloc(26);buffer.write('RIFF');buffer.writeUInt32LE(18,4);buffer.write('WEBP',8);buffer.write('VP8L',12);buffer.writeUInt32LE(5,16);buffer[20]=47;buffer.writeUInt32LE(((width-1)|((height-1)<<14)|(version<<29))>>>0,21);return buffer;}
test('simple lossless WebP bounds structure dimensions version and padding',async()=>{
 const real=await prepareRaster(Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAkAAEAdQqFIUuYCBiOh/AAA=','base64'));assert.equal(real.width,3);assert.equal(real.height,2);
 const buffer=image(),prepared=await prepareRaster(buffer);assert.equal(prepared.width,2);assert.equal(prepared.height,3);assert.equal(prepared.encoding,'VP8L');assert.deepEqual(prepared.data,buffer);
 for(const value of [image(8193,1),image(8192,8192),image(2,3,1)])assert.throws(()=>prepareSimpleWebp(value));
 for(const offset of [0,8,12]){const alias=image();alias[offset]|=128;assert.throws(()=>prepareSimpleWebp(alias));}
 const signature=image();signature[20]=0;assert.throws(()=>prepareSimpleWebp(signature));
 const padding=image();padding[25]=1;assert.throws(()=>prepareSimpleWebp(padding));
 assert.throws(()=>prepareSimpleWebp(buffer.subarray(0,24)));
});
