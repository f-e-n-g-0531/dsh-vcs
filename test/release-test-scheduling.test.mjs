import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
test('default and TAP release runner bound file concurrency without skipping or extending production budgets',()=>{
 const manifest=JSON.parse(readFileSync('package.json','utf8')),runner=readFileSync('scripts/run-release-tests.mjs','utf8');
 assert.equal(manifest.scripts.test,'node --test --test-concurrency=2 test/*.test.mjs');
 assert.ok(runner.includes("['--test','--test-concurrency=2','--test-reporter=tap',...files]"));
 assert.ok(runner.includes("filter(n=>n.endsWith('.test.mjs')).sort()"));
 assert.doesNotMatch(runner,/test-name-pattern|test-skip-pattern|test-timeout|test-isolation/);
 assert.ok(readdirSync('test').filter(n=>n.endsWith('.test.mjs')).length>100);
 assert.ok(readFileSync('local-command.mjs','utf8').includes('TIMEOUT = 15000'));
});
