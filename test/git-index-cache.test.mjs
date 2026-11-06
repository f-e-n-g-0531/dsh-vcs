import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {replaceGitIndexEntry,parseGitIndex} from '../src/git-index.mjs';
function fixture(){const rows=['a','b'].map(name=>{const row=Buffer.alloc(64);row.fill(1,0,40);row.writeUInt32BE(0o100644,24);row.fill(0xaa,40,60);row.writeUInt16BE(1,60);row.write(name,62);return row;});const header=Buffer.alloc(12);header.write('DIRC');header.writeUInt32BE(2,4);header.writeUInt32BE(2,8);const body=Buffer.concat([header,...rows]);return Buffer.concat([body,createHash('sha1').update(body).digest()]);}
test('candidate invalidates all stat caches so a newer index cannot hide untouched racy changes',()=>{const before=fixture(),candidate=replaceGitIndexEntry(before,{path:'a',expectedOid:'a'.repeat(40),expectedMode:'100644',oid:'b'.repeat(40),mode:'100644'});for(const start of [12,76]){assert.ok(candidate.subarray(start,start+24).every(byte=>byte===0));assert.ok(candidate.subarray(start+28,start+40).every(byte=>byte===0));}assert.equal(parseGitIndex(candidate).entries[1].oid,'a'.repeat(40));});
