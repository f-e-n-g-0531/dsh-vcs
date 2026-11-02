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

test('local runner rejects missing commands and terminates a stubborn process tree', async () => {
  await assert.rejects(run('dsh-vcs-missing-executable', [], process.cwd()), {code: 'ENOENT'});
  const script = "const {spawn}=require('node:child_process');process.on('SIGTERM',()=>{});spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"],{stdio:['ignore','inherit','inherit']});setInterval(()=>{},1000);";
  const began = Date.now();
  await assert.rejects(node(script, undefined, {timeoutMs: 400}), {code: 'TIMEOUT'});
  assert.ok(Date.now() - began < 6000, 'cleanup must terminate inherited pipe holders');
});

test('local runner retains preabort and deadline error contracts', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(node('process.exit(0)', undefined, {signal: controller.signal}), {code: 'ABORT_ERR'});
  await assert.rejects(node('setInterval(()=>{},1000)', undefined, {timeoutMs: 100}), {code: 'TIMEOUT'});
});
