import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('reference primitive source retains old-OID conditional update and nonrecursive hook cleanup',async()=>{const source=await readFile('git-ref-cas.mjs','utf8');assert.match(source,/update-ref.*--no-deref/);assert.match(source,/ref,newOid,expectedOid/);assert.match(source,/core\.hooksPath=/);assert.match(source,/--no-includes/);assert.doesNotMatch(source,/recursive\s*:\s*true/);});
