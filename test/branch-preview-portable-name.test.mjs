import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareBranchCreate} from '../branch-create-preview.mjs';
for(const character of ['<','>','|',String.fromCharCode(34)])test('portable branch preview rejects '+character+' before I/O',async()=>{await assert.rejects(prepareBranchCreate({type:'git',root:process.cwd()},{name:'topic'+character+'x'}),/Safe portable short branch name/);});