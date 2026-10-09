import test from 'node:test';import assert from 'node:assert/strict';import {prepareBaselineJpeg} from '../image-preview.mjs';
const segment=(marker,data)=>{const size=Buffer.alloc(2);size.writeUInt16BE(data.length+2);return Buffer.concat([Buffer.from([255,marker]),size,Buffer.from(data)]);};
const jpeg=(frame=192,width=1)=>Buffer.concat([Buffer.from([255,216]),segment(225,[1,2,3]),segment(frame,[8,0,1,width>>8,width&255,1,1,17,0]),segment(218,[1,1,0,0,63,0]),Buffer.from([1,255,0,2,255,217])]);
test('baseline JPEG structural gate strips metadata and bounds unsupported inputs',()=>{
 const result=prepareBaselineJpeg(jpeg());assert.equal(result.width,1);assert.equal(result.height,1);assert.equal(result.mime,'image/jpeg');assert.equal(result.metadataStripped,true);assert.equal(result.data.includes(Buffer.from([255,225])),false);
 for(const value of [jpeg(194),jpeg(192,8193),Buffer.concat([jpeg(),Buffer.from([0])]),jpeg().subarray(0,-1),Buffer.alloc(2097153),Buffer.from('svg')])assert.throws(()=>prepareBaselineJpeg(value));
});
