import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('commit preview explicitly binds both independent identities and exact target result fields',async()=>{const source=await readFile('src/CommitPanel.jsx','utf8');assert.ok(source.includes('sameIdentity(value.author,submitted.author)'));assert.ok(source.includes('sameIdentity(value.committer,submitted.committer)'));assert.ok(source.includes('value.message!==submitted.message'));for(const name of ['head','ref','tree','indexDigest'])assert.ok(source.includes('result.'+name));assert.ok(source.includes('vcs/commit-confirm'));assert.ok(!source.includes('vcs/index-stage-confirm'));});
