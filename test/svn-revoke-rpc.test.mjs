import test from 'node:test';
import assert from 'node:assert/strict';
import {createSvnRuntime} from '../src/svn-runtime.mjs';
import {createSvnRpc} from '../src/svn-rpc.mjs';
import {waitForReadiness} from './helpers/readiness.mjs';

test('explicit SVN revoke bypasses saturated history slots and suppresses late responses', {timeout: 5000}, async () => {
  const address = {sessionId: 's', repositoryId: 'r'};
  const identity = {
    cwd: '/wc', root: 'https://example.test/repo',
    uuid: '12345678-1234-1234-1234-123456789abc', scope: '/',
  };
  const finishes = [];
  const requests = [];
  let calls = 0;
  let aborted = 0;
  const runtime = createSvnRuntime({
    resolveIdentity: async () => identity,
    transport: async (_plan, {signal}) => {
      calls++;
      return new Promise((resolve, reject) => {
        finishes.push(() => resolve('<log/>'));
        signal.addEventListener('abort', () => {
          aborted++;
          reject(signal.reason);
        }, {once: true});
      });
    },
  });
  const rpc = createSvnRpc(runtime);
  const log = payload => {
    const request = rpc('vcs/svn-log', payload);
    requests.push(request);
    return request;
  };
  try {
    const offer = await rpc('vcs/svn-describe', address);
    const grant = await rpc('vcs/svn-approve', {...address, offer: offer.value.offer, explicit: true});
    const token = grant.value.token;
    const p = {...address, token, snapshot: '2'};
    const one = log(p);
    const two = log(p);
    await waitForReadiness(() => finishes.length === 2, [one, two], {label: 'both history slots'});
    assert.equal((await rpc('vcs/svn-log', p)).error.code, 'vcs/busy');
    assert.equal((await rpc('vcs/svn-revoke', {...address, sessionId: 'other', token})).ok, false);
    assert.equal((await rpc('vcs/svn-revoke', {...address, token, root: identity.root})).ok, false);
    assert.deepEqual((await rpc('vcs/svn-revoke', {...address, token})).value, {revoked: true});
    assert.equal(aborted, 2);
    finishes.forEach(finish => finish());
    assert.equal((await one).ok, false);
    assert.equal((await two).ok, false);
    assert.equal((await rpc('vcs/svn-log', p)).ok, false);
    assert.equal(calls, 2);

    const offer2 = await rpc('vcs/svn-describe', address);
    const grant2 = await rpc('vcs/svn-approve', {...address, offer: offer2.value.offer, explicit: true});
    const next = log({...p, token: grant2.value.token});
    await waitForReadiness(() => calls === 3, [next], {label: 'replacement history request'});
    runtime.revokeSession('s');
    assert.equal(aborted, 3);
    assert.equal((await next).ok, false);
  } finally {
    runtime.revokeSession('s');
    finishes.forEach(finish => finish());
    await Promise.allSettled(requests);
  }
});
