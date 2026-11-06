import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deflateSync,inflateSync} from 'node:zlib';
for(const format of ['sha1','sha256'])test('captured Git blob oracle preserves binary bytes and exact length header: '+format,()=>{for(const bytes of [Buffer.alloc(0),Buffer.from([0,255,13,10,128]),Buffer.from('中文\n')]){const raw=Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes]),oid=createHash(format).update(raw).digest('hex');assert.equal(oid.length,format==='sha1'?40:64);assert.deepEqual(inflateSync(deflateSync(raw),{maxOutputLength:2*1024*1024+64}),raw);const split=raw.indexOf(0);assert.equal(raw.subarray(0,split).toString(),'blob '+bytes.length);assert.deepEqual(raw.subarray(split+1),bytes);}});
test('bounded inflate rejects compressed data beyond the approved raw-byte budget',()=>{const zipped=deflateSync(Buffer.alloc(2*1024*1024+65));assert.throws(()=>inflateSync(zipped,{maxOutputLength:2*1024*1024+64}));});
