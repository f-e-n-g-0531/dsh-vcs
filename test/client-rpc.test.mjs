import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientRpc} from '../src/client-rpc.mjs';

test('client RPC preserves connection receiver channel address and cancellation signal', async () => {
  const payload = {sessionId: 'session', repositoryId: 'opaque'};
  const signal = new AbortController().signal;
  const value = {commits: []};
  const connection = {rpc: {
    async call(...args) {
      assert.equal(this, connection.rpc);
      assert.deepEqual(args, ['/vcs-rpc', 'vcs/history', payload, signal]);
      return {ok: true, value};
    },
  }};
  assert.equal(await createClientRpc(connection, () => 'fallback')('vcs/history', payload, signal), value);
});

test('client RPC retains typed recovery and lazily resolves fallback text', async () => {
  let fallbackCalls = 0;
  let result = {ok: false, error: {code: 'vcs/svn-consent-required', message: 'Review consent'}};
  const rpc = createClientRpc({rpc: {call: async () => result}}, () => { fallbackCalls++; return 'localized'; });
  await assert.rejects(rpc('vcs/svn-log', {}), error => error.code === 'vcs/svn-consent-required' && error.message === 'Review consent');
  assert.equal(fallbackCalls, 0);
  result = {ok: false};
  await assert.rejects(rpc('vcs/status', {}), /localized/);
  assert.equal(fallbackCalls, 1);
});
