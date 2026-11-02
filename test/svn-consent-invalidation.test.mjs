import test from 'node:test';
import assert from 'node:assert/strict';
import {createSvnRuntime} from '../src/svn-runtime.mjs';
import {waitForReadiness} from './helpers/readiness.mjs';

test('replacement and capacity eviction abort in-flight revoked capabilities', {timeout: 5000}, async () => {
  const address = {sessionId: 's', repositoryId: 'r'};
  const identity = {
    cwd: '/wc', root: 'https://example.test/repo',
    uuid: '12345678-1234-1234-1234-123456789abc', scope: '/',
  };
  const sessions = new Set(['s']);
  const finishes = [];
  const requests = [];
  let started = false;
  let signal;
  const runtime = createSvnRuntime({
    resolveIdentity: async () => identity,
    transport: async (_plan, options) => {
      signal = options.signal;
      started = true;
      return new Promise((resolve, reject) => {
        finishes.push(() => resolve('<log/>'));
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {once: true});
      });
    },
  });
  const approve = async a => {
    sessions.add(a.sessionId);
    const offer = await runtime.describe(a);
    return runtime.approve(a, {offer: offer.offer, explicit: true});
  };
  const log = token => {
    const request = runtime.log(address, {token, snapshot: '2'});
    requests.push(request);
    return request;
  };
  try {
    const first = await approve(address);
    const pending = log(first.token);
    await waitForReadiness(() => started, [pending], {label: 'first consent request'});
    // Observe expected cancellation immediately before the action that triggers it.
    const observed = assert.rejects(pending, {name: 'AbortError'});
    requests.push(observed);
    await approve(address);
    assert.equal(signal.aborted, true);
    await observed;

    started = false;
    const second = await approve(address);
    const evicted = log(second.token);
    await waitForReadiness(() => started, [evicted], {label: 'capacity eviction request'});
    const failure = assert.rejects(evicted, {name: 'AbortError'});
    requests.push(failure);
    for (let i = 0; i < 32; i++) await approve({sessionId: 's' + i, repositoryId: 'r'});
    assert.equal(signal.aborted, true);
    await failure;
  } finally {
    for (const sessionId of sessions) runtime.revokeSession(sessionId);
    finishes.forEach(finish => finish());
    await Promise.allSettled(requests);
  }
});
