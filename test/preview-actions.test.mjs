import test from 'node:test';
import assert from 'node:assert/strict';
import {canLoadLarge,isPinnedSnapshot} from '../src/preview-actions.mjs';
test('structured preview overrides all notice text including translated text',()=>{
 assert.equal(canLoadLarge({preview:{canLoadLarge:true},notice:'超出预览范围'}),true);
 for(const preview of [null,{}, {canLoadLarge:false},{canLoadLarge:'true'}])assert.equal(canLoadLarge({preview,notice:'2 MiB'}),false);
 assert.equal(canLoadLarge({notice:'exceeds 2 MiB'}),true);
 assert.equal(canLoadLarge({notice:'binary'}),false);
});
test('navigation accepts pinned SHA1 and SHA256, never mutable refs',()=>{
 for(const n of [40,64])assert.equal(isPinnedSnapshot('a'.repeat(n)),true);
 for(const value of [null,'HEAD','main','a'.repeat(39),'A'.repeat(40)])assert.equal(isPinnedSnapshot(value),false);
});
