import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {prepareBaselineJpeg} from '../image-preview.mjs';
const segment=(marker,data)=>{const size=Buffer.alloc(2);size.writeUInt16BE(data.length+2);return Buffer.concat([Buffer.from([255,marker]),size,Buffer.from(data)]);};
const jpeg=(frame=192,width=1)=>Buffer.concat([Buffer.from([255,216]),segment(225,[1,2,3]),segment(219,[0,...Array(64).fill(1)]),segment(196,[0,1,...Array(15).fill(0),0,16,1,...Array(15).fill(0),0]),segment(frame,[8,0,1,width>>8,width&255,1,1,17,0]),segment(218,[1,1,0,0,63,0]),Buffer.from([1,255,0,2,255,217])]);
const prog=(ahal=0)=>Buffer.concat([Buffer.from([255,216]),segment(225,[1,2,3]),segment(219,[0,...Array(64).fill(1)]),segment(196,[0,1,...Array(15).fill(0),0,16,1,...Array(15).fill(0),0]),segment(194,[8,0,1,0,1,1,1,17,0]),segment(218,[1,1,0,0,63,ahal]),Buffer.from([1,255,0,2,255,217])]);
test('baseline JPEG structural gate strips metadata and bounds unsupported inputs',()=>{
 const result=prepareBaselineJpeg(jpeg());assert.equal(result.width,1);assert.equal(result.height,1);assert.equal(result.mime,'image/jpeg');assert.equal(result.metadataStripped,true);assert.equal(result.data.includes(Buffer.from([255,225])),false);
 for(const value of [jpeg(192,8193),Buffer.concat([jpeg(),Buffer.from([0])]),jpeg().subarray(0,-1),Buffer.alloc(2097153),Buffer.from('svg')])assert.throws(()=>prepareBaselineJpeg(value));
});
test('progressive JPEG structural gate reads dimensions and rejects invalid scan parameters',()=>{
 const raw=readFileSync(new URL('./fixtures/progressive-16x12.jpg',import.meta.url));
 const result=prepareBaselineJpeg(raw);assert.equal(result.width,16);assert.equal(result.height,12);assert.equal(result.mime,'image/jpeg');assert.equal(result.metadataStripped,true);
 assert.equal(prepareBaselineJpeg(prog(0)).width,1);
 for(const bad of [prog(0).subarray(0,60),Buffer.concat([prog(0),Buffer.from([0])])])assert.throws(()=>prepareBaselineJpeg(bad));
 // Successive-approximation high nibble beyond 13 is invalid.
 assert.throws(()=>prepareBaselineJpeg(prog(0xE0)));
});
