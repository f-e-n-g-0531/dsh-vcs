import test from 'node:test';
import assert from 'node:assert/strict';
import {diffStatus} from '../src/diff-status.mjs';
test('computation status fails closed on absent stale timed out or unknown result',()=>{
 assert.equal(diffStatus(null),'pending');
 const state=(result,current=true)=>({diff:{get:()=>result},isDiffUpToDate:{get:()=>current}});
 assert.equal(diffStatus(state({quitEarly:false})),'complete');
 assert.equal(diffStatus(state({quitEarly:true})),'incomplete');
 assert.equal(diffStatus(state({})),'incomplete');
 assert.equal(diffStatus(state({quitEarly:false},false)),'pending');
});
