import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPng} from '../image-preview.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=','base64');
function chunk(type,data){const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);data.copy(b,8);let crc=0xffffffff;for(const byte of b.subarray(4,-4)){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}b.writeUInt32BE((crc^0xffffffff)>>>0,b.length-4);return b;}
// Generate a valid IDAT CRC independently of the canned fixture's provenance.
const valid=Buffer.concat([png.subarray(0,33),chunk('IDAT',png.subarray(41,52)),chunk('IEND',Buffer.alloc(0))]);
test('PNG palette and reserved chunk bit constraints are enforced',()=>{
 const header=Buffer.from(valid.subarray(16,29));header[8]=1;header[9]=3;
 const prefix=Buffer.concat([valid.subarray(0,8),chunk('IHDR',header)]),palette=chunk('PLTE',Buffer.from([0,0,0,255,255,255])),tail=valid.subarray(33);
 assert.equal(inspectPng(Buffer.concat([prefix,palette,tail])).width,1);
 for(const parts of [[prefix,tail],[prefix,palette,palette,tail],[prefix,chunk('PLTE',Buffer.alloc(9)),tail],[prefix,chunk('PLTE',Buffer.alloc(1)),tail],[prefix,chunk('PLTE',Buffer.alloc(0)),tail],[valid.subarray(0,33),palette,tail],[prefix,palette,tail.subarray(0,-12),palette,tail.subarray(-12)],[prefix,palette,chunk('abca',Buffer.alloc(0)),tail]])assert.throws(()=>inspectPng(Buffer.concat(parts)));
});
test('PNG metadata chunk count data continuity and pixel budget are bounded',()=>{
 const prefix=valid.subarray(0,33),tail=valid.subarray(33),empty=chunk('teXT',Buffer.alloc(0));
 for(const type of ['iCCP','zTXt','iTXt'])assert.throws(()=>inspectPng(Buffer.concat([prefix,chunk(type,Buffer.alloc(0)),tail])),/metadata/);
 assert.equal(inspectPng(Buffer.concat([prefix,...Array(4093).fill(empty),tail])).width,1);
 assert.throws(()=>inspectPng(Buffer.concat([prefix,...Array(4094).fill(empty),tail])),/bounds/);
 assert.throws(()=>inspectPng(Buffer.concat([prefix,tail.subarray(0,-12),empty,chunk('IDAT',Buffer.alloc(0)),tail.subarray(-12)])),/Noncontiguous/);
 const header=Buffer.from(valid.subarray(16,29));header.writeUInt32BE(4000);header.writeUInt32BE(4000,4);
 assert.equal(inspectPng(Buffer.concat([valid.subarray(0,8),chunk('IHDR',header),tail])).height,4000);
 header.writeUInt32BE(4001,4);assert.throws(()=>inspectPng(Buffer.concat([valid.subarray(0,8),chunk('IHDR',header),tail])),/dimensions/);
});
test('PNG structural inspection returns bounded metadata',()=>{assert.deepEqual(inspectPng(valid),{mime:'image/png',width:1,height:1,bytes:valid.length});});
test('PNG gate rejects non-raster signatures corruption truncation animation and size overflow',()=>{
 for(const b of [Buffer.from('<svg/>'),valid.subarray(0,-1),Buffer.concat([valid,Buffer.from('tail')]),Buffer.alloc(2*1024*1024+1),Buffer.concat([valid.subarray(0,33),chunk('acTL',Buffer.alloc(8)),valid.subarray(33)])])assert.throws(()=>inspectPng(b));
 const corrupt=Buffer.from(valid);corrupt[45]^=1;assert.throws(()=>inspectPng(corrupt),/CRC/);
 const header=Buffer.from(valid.subarray(16,29));header.writeUInt32BE(8193);assert.throws(()=>inspectPng(Buffer.concat([valid.subarray(0,8),chunk('IHDR',header),valid.subarray(33)])),/dimensions/);
});
