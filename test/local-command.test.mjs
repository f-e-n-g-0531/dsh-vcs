import test from 'node:test';
import assert from 'node:assert/strict';
import {run} from '../local-command.mjs';

const node = (script, max, options) => run(process.execPath, ['-e', script], process.cwd(), max, options);

test('local runner shares stream budget and preserves command errors', async () => {
  assert.equal((await node("process.stdout.write('exact')")).toString(), 'exact');
  await assert.rejects(node("process.stdout.write('a'.repeat(60));process.stderr.write('b'.repeat(60))", 100), {code: 'TOO_LARGE'});
  await assert.rejects(node("process.stderr.write('failure');process.exit(7)"), error => error.code === 'VCS_COMMAND' && error.exitCode === 7 && error.message.endsWith('failure'));
  assert.equal((await node("process.stdout.write('recovered')")).toString(), 'recovered');
});

test('local runner retains preabort and deadline error contracts', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(node('process.exit(0)', undefined, {signal: controller.signal}), {code: 'ABORT_ERR'});
  await assert.rejects(node('setInterval(()=>{},1000)', undefined, {timeoutMs: 100}), {code: 'TIMEOUT'});
});
