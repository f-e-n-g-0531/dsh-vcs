import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseGitIndex} from '../src/git-index.mjs';
function index(extensions=[]){const header=Buffer.alloc(12);header.write('DIRC');header.writeUInt32BE(2,4);const parts=extensions.map(name=>{const h=Buffer.alloc(8);h.write(name);return h;});const body=Buffer.concat([header,...parts]);return Buffer.concat([body,createHash('sha1').update(body).digest()]);}
test('duplicate extension signatures are rejected rather than ambiguously interpreted',()=>assert.throws(()=>parseGitIndex(index(['TREE','TREE']))));
test('skipHash zero checksum is explicitly unsupported, not described as corrupt',()=>{const bytes=index();bytes.fill(0,bytes.length-20);assert.throws(()=>parseGitIndex(bytes),/skipHash|unverifiable|unsupported/i);});
