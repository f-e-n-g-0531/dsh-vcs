import test from 'node:test';import assert from 'node:assert/strict';import {prepareSimpleWebp} from '../image-preview.mjs';
function webp(kind,payload){const result=Buffer.alloc(20+payload.length+(payload.length&1));result.write('RIFF');result.writeUInt32LE(result.length-8,4);result.write('WEBP',8);result.write(kind,12);result.writeUInt32LE(payload.length,16);Buffer.from(payload).copy(result,20);return result;}
test('simple WebP header gate bounds RIFF and refuses extended animated and corrupt frames',()=>{
 const lossy=webp('VP8 ',[0x30,0,0,157,1,42,1,0,1,0,0]),lossless=webp('VP8L',[47,0,0,0,0,1]);for(const value of [lossy,lossless]){const data=prepareSimpleWebp(value);assert.equal(data.width,1);assert.equal(data.height,1);assert.equal(data.mime,'image/webp');}
 const tail=Buffer.concat([lossy,Buffer.from([0])]),badPadding=Buffer.from(lossy);badPadding[badPadding.length-1]=1;
 for(const value of [tail,badPadding,webp('VP8X',Array(10).fill(0)),webp('ANIM',Array(10).fill(0)),webp('VP8 ',Array(10).fill(0)),webp('VP8L',[47,0,0,0,224,1]),Buffer.alloc(2097153)])assert.throws(()=>prepareSimpleWebp(value));
});
