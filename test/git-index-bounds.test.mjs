import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGitIndex} from '../src/git-index.mjs';
const seal=b=>Buffer.concat([b,createHash('sha1').update(b).digest()]);
function fixture(){const header=Buffer.alloc(12);header.write('DIRC');header.writeUInt32BE(2,4);header.writeUInt32BE(1,8);const row=Buffer.alloc(64);row.writeUInt32BE(0o100644,24);row.fill(0xaa,40,60);row.writeUInt16BE(1,60);row.write('a',62);return seal(Buffer.concat([header,row]));}
test('every truncated index offset rejects with controlled error',()=>{const source=fixture();for(let cut=0;cut<source.length;cut++){assert.throws(()=>parseGitIndex(source.subarray(0,cut)),e=>e instanceof Error&&!(e instanceof RangeError));}});
test('checksum-valid truncated entry bodies fail closed at every offset',()=>{const source=fixture();for(let cut=0;cut<76;cut++)assert.throws(()=>parseGitIndex(seal(source.subarray(0,cut))),e=>e instanceof Error&&!(e instanceof RangeError));});
test('malformed count and extension sizes remain bounded with valid checksums',()=>{let seed=123456789;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};for(let i=0;i<500;i++){const body=Buffer.from(fixture().subarray(0,-20));body.writeUInt32BE(100001+next()%1000000,8);assert.throws(()=>parseGitIndex(seal(body)),e=>e instanceof Error&&!(e instanceof RangeError));}for(const count of [0xffffffff,0xfffffffe,0x80000000]){const header=Buffer.alloc(20);header.write('DIRC');header.writeUInt32BE(2,4);header.write('TREE',12);header.writeUInt32BE(count,16);assert.throws(()=>parseGitIndex(seal(header)),/payload/);}});
