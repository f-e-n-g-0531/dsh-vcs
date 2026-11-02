import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {waitForReadiness} from './helpers/readiness.mjs';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
};

test('readiness succeeds once the predicate becomes true', {timeout: 5000}, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const request = deferred();
  let ready = false;
  const waiting = waitForReadiness(() => ready, [request.promise]);
  ready = true;
  t.mock.timers.tick(1);
  await waiting;
  request.resolve();
  await request.promise;
});

test('readiness observes rejection without waiting for the next poll', {timeout: 5000}, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const request = deferred();
  const reason = new Error('request failed');
  const waiting = waitForReadiness(() => false, [request.promise], {intervalMs: 100});
  const observed = assert.rejects(waiting, error => error === reason);
  request.reject(reason);
  await observed;
});

test('readiness rejects fulfillment before ready without waiting for the next poll', {timeout: 5000}, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const request = deferred();
  const waiting = waitForReadiness(() => false, [request.promise], {
    intervalMs: 100, label: 'transport start',
  });
  const observed = assert.rejects(waiting, /Request fulfilled before transport start/);
  request.resolve({ok: false});
  await observed;
});

test('readiness has a fixed deadline even when requests never settle', {timeout: 5000}, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const request = deferred();
  const waiting = waitForReadiness(() => false, [request.promise], {
    timeoutMs: 20, intervalMs: 100, label: 'transport start',
  });
  const observed = assert.rejects(waiting, /Timed out waiting for transport start after 20ms/);
  t.mock.timers.tick(20);
  await observed;
  // A later rejection is still observed after the deadline has already failed.
  request.reject(new Error('late failure'));
  await nextTurn();
  await Promise.allSettled([request.promise]);
});

test('readiness clears timers after success, rejection, early fulfillment and deadline', {timeout: 5000}, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const setTimer = t.mock.method(globalThis, 'setTimeout');
  const clearTimer = t.mock.method(globalThis, 'clearTimeout');
  for (const outcome of ['success', 'rejection', 'fulfillment', 'deadline']) {
    const request = deferred();
    let ready = false;
    let checks = 0;
    const firstTimer = setTimer.mock.callCount();
    const firstClear = clearTimer.mock.callCount();
    const waiting = waitForReadiness(() => { checks++; return ready; }, [request.promise], {
      timeoutMs: 20, intervalMs: 1,
    });
    const observed = outcome === 'success' ? waiting : assert.rejects(waiting);
    if (outcome === 'success') {
      ready = true;
      t.mock.timers.tick(1);
    } else if (outcome === 'rejection') {
      request.reject(new Error('request failed'));
    } else if (outcome === 'fulfillment') {
      request.resolve();
    } else {
      t.mock.timers.tick(20);
    }
    await observed;
    const handles = setTimer.mock.calls.slice(firstTimer).map(call => call.result);
    const cleared = clearTimer.mock.calls.slice(firstClear).map(call => call.arguments[0]);
    // Earlier polling timers may have fired; the deadline and latest poll must be cleared.
    assert.ok(handles.length >= 2);
    assert.ok(cleared.includes(handles[0]), outcome);
    assert.ok(cleared.includes(handles.at(-1)), outcome);
    const completedChecks = checks;
    t.mock.timers.tick(1000);
    assert.equal(checks, completedChecks, outcome);
    request.reject(new Error('cleanup rejection'));
    await nextTurn();
    await Promise.allSettled([request.promise]);
  }
});

test('readiness observes all requests, including a later rejected sibling', {timeout: 5000}, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const first = deferred();
  const sibling = deferred();
  const reason = new Error('first failure');
  const waiting = waitForReadiness(() => false, [first.promise, sibling.promise]);
  const observed = assert.rejects(waiting, error => error === reason);
  first.reject(reason);
  await observed;
  sibling.reject(new Error('later failure'));
  await nextTurn();
  await Promise.allSettled([first.promise, sibling.promise]);
});

test('already ready predicates still observe subsequent request rejection', {timeout: 5000}, async () => {
  const request = deferred();
  await waitForReadiness(() => true, [request.promise]);
  request.reject(new Error('after readiness'));
  await nextTurn();
  await Promise.allSettled([request.promise]);
});

test('readiness reports a predicate failure and cleans up polling', {timeout: 5000}, async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const reason = new Error('predicate failed');
  const waiting = waitForReadiness(() => { throw reason; });
  await assert.rejects(waiting, error => error === reason);
  t.mock.timers.tick(1000);
});
