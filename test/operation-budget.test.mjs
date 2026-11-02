import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {withOperationBudget, currentOperationBudget} from '../src/operation-budget.mjs';
import {run} from '../local-command.mjs';
import {createHandler} from '../index.mjs';

test('operation budget is shared by sequential children and nested scopes', async () => {
  await assert.rejects(withOperationBudget({timeoutMs: 180}, async () => {
    const first = currentOperationBudget();
    await delay(100);
    await withOperationBudget({timeoutMs: 15000}, async () => {
      assert.ok(currentOperationBudget().deadline <= first.deadline);
      await run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], process.cwd());
    });
  }), {code: 'TIMEOUT'});
  assert.equal(currentOperationBudget(), undefined);
});

test('operation rejects late async success and preserves caller cancellation', async () => {
  await assert.rejects(withOperationBudget({timeoutMs: 20}, async () => {await delay(40); return 'late';}), {code: 'TIMEOUT'});
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(withOperationBudget({signal: controller.signal}, async () => assert.fail('preabort')), {name: 'AbortError'});
});

test('host holds capacity during deadline cleanup and rejects late results', async () => {
  const repo = {id: 'r', type: 'git', root: '/fixture'};
  let began; const started = new Promise(resolve => began = resolve);
  const handler = createHandler({sessions: {get: () => ({header: {cwd: '/fixture'}})}}, {
    discoverRepositories: async () => ({repositories: [repo], warnings: []}),
    listChanges: async () => {began(); await delay(100); return {changes: []};},
  }, 1, {operationTimeoutMs: 30});
  assert.equal((await handler('vcs/repositories', {sessionId: 's'})).ok, true);
  const pending = handler('vcs/status', {sessionId: 's', repositoryId: 'r'});
  await started; await delay(50);
  assert.equal((await handler('vcs/status', {sessionId: 's', repositoryId: 'r'})).error.code, 'vcs/busy');
  assert.equal((await pending).error.code, 'vcs/timeout');
  assert.equal((await handler('vcs/repositories', {sessionId: 's'})).ok, true);
});
