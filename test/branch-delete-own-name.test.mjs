import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareBranchDelete} from '../branch-delete-preview.mjs';
test('missing own branch name never consults Object.prototype getter',async()=>{let calls=0;Object.defineProperty(Object.prototype,'name',{configurable:true,get(){calls++;return 'topic';}});try{await assert.rejects(prepareBranchDelete({type:'git',root:process.cwd()},{}));assert.equal(calls,0);}finally{delete Object.prototype.name;}});