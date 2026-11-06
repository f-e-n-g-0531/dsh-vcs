import test from 'node:test';
import assert from 'node:assert/strict';
import {settledReads} from '../src/settled-reads.mjs';
test('all independent siblings start and drain before fixed-order rejection',async()=>{let finish,started=0,drained=false;const first=Error('first'),second=Error('second');const work=settledReads([async()=>{started++;throw first;},async()=>{started++;await new Promise(r=>finish=r);drained=true;throw second;}]);await Promise.resolve();await Promise.resolve();assert.equal(started,2);let done=false;const observed=work.catch(e=>{done=true;assert.strictEqual(e,first);assert.equal(drained,true);});await Promise.resolve();assert.equal(done,false);finish();await observed;});
test('synchronous errors drain siblings; successful output retains input order',async()=>{let ran=false;await assert.rejects(settledReads([()=>{throw Error('sync');},async()=>{ran=true;}]),/sync/);assert.equal(ran,true);assert.deepEqual(await settledReads([async()=>1,()=>2]),[1,2]);});
