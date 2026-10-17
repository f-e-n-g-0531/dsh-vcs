import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../index.mjs';

// The test repeats the request contract on purpose: it is an independent oracle for
// the endpoint roster and validation precedence that index.mjs derives internally.
const A40 = 'a'.repeat(40), A64 = 'a'.repeat(64);
const ctx = { sessions: { get: () => ({ header: { cwd: '/workspace' } }) }, sessionPersistence: { stat: async () => undefined } };
const api = { discoverRepositories: async () => ({ repositories: [], truncated: false, warnings: [] }) };
const call = (endpoint, payload, signal) => createHandler(ctx, api)(endpoint, payload, signal);

// Every action endpoint with a payload that passes shape validation but has no grant.
const ADDRESSED = {
  'vcs/svn-identity': { sessionId: 's', repositoryId: 'r' },
  'vcs/references': { sessionId: 's', repositoryId: 'r' },
  'vcs/stash-list': { sessionId: 's', repositoryId: 'r' },
  'vcs/grep': { sessionId: 's', repositoryId: 'r', query: 'needle' },
  'vcs/status': { sessionId: 's', repositoryId: 'r', mode: 'all' },
  'vcs/compare': { sessionId: 's', repositoryId: 'r', mode: 'all', id: 'file' },
  'vcs/conflict-stages': { sessionId: 's', repositoryId: 'r', mode: 'all', id: A64 },
  'vcs/history': { sessionId: 's', repositoryId: 'r' },
  'vcs/commit': { sessionId: 's', repositoryId: 'r', commit: A40 },
  'vcs/commit-compare': { sessionId: 's', repositoryId: 'r', commit: A40, id: A64 },
  'vcs/file-history': { sessionId: 's', repositoryId: 'r', commit: A40, id: A64 },
  'vcs/blame': { sessionId: 's', repositoryId: 'r', commit: A40, id: A64 },
  'vcs/revision-changes': { sessionId: 's', repositoryId: 'r', base: A40, target: A40 },
  'vcs/revision-compare': { sessionId: 's', repositoryId: 'r', base: A40, target: A40, id: A64 },
  'vcs/revision-image': { sessionId: 's', repositoryId: 'r', base: A40, target: A40, id: A64 },
  'vcs/tree': { sessionId: 's', repositoryId: 'r', commit: A40 },
  'vcs/tree-file': { sessionId: 's', repositoryId: 'r', commit: A40, path: 'file.txt' },
  'vcs/tree-segment': { sessionId: 's', repositoryId: 'r', commit: A40, path: 'file.txt' },
  'vcs/tree-history': { sessionId: 's', repositoryId: 'r', commit: A40, path: 'file.txt' },
  'vcs/commit-image': { sessionId: 's', repositoryId: 'r', commit: A40, id: A64 },
  'vcs/workspace-image': { sessionId: 's', repositoryId: 'r', id: A64 },
};

test('action endpoint roster and field whitelists derive from the request contract', async () => {
  assert.deepEqual((await call('vcs/repositories', { sessionId: 's' })).value, { cwd: '/workspace', repositories: [], truncated: false, warnings: [] });
  for (const [endpoint, payload] of Object.entries(ADDRESSED)) {
    assert.equal((await call(endpoint, payload)).error?.code, 'vcs/rediscover-required', endpoint);
    const unknownField = await call(endpoint, { ...payload, cwd: '/evil' });
    assert.equal(unknownField.error?.code, 'vcs/invalid-request', endpoint + ' unknown field');
    assert.equal(unknownField.error.message, 'Only Session-addressed repository requests are supported; unknown payload field.');
  }
  for (const endpoint of ['vcs/svn-log', 'vcs/runtime-info2', 'vcs/statuses', 'unknown', '', null]) {
    assert.equal((await call(endpoint, null)).error?.code, 'vcs/not-found', String(endpoint));
  }
  assert.equal((await call('vcs/svn-log', { sessionId: 's', repositoryId: 'r' })).error.message, 'Unknown VCS endpoint.');
});

test('payload shape and Session addressing are rejected before any grant lookup', async () => {
  for (const endpoint of ['vcs/status', 'vcs/repositories', 'vcs/history']) {
    for (const payload of [null, [], 'text', 0]) {
      const result = await call(endpoint, payload);
      assert.equal(result.error?.code, 'vcs/invalid-request', endpoint);
      assert.equal(result.error.message, 'An object payload is required.');
    }
  }
  assert.equal((await call('vcs/status', { sessionId: 's', repositoryId: 0 })).error.message, 'A discovered repositoryId is required.');
  assert.equal((await call('vcs/status', { sessionId: 's', repositoryId: 'x'.repeat(1025) })).error.message, 'A discovered repositoryId is required.');
  assert.equal((await call('vcs/status', { sessionId: '../bad', repositoryId: 0 })).error.message, 'A discovered repositoryId is required.');
  assert.equal((await call('vcs/status', { sessionId: '../bad', repositoryId: 'r' })).error.message, 'A valid sessionId is required.');
  assert.equal((await call('vcs/repositories', { sessionId: '../bad', subdirectory: '../evil' })).error.message, 'subdirectory must be a relative path within the Session directory.');
});

test('multi-field validation keeps the documented precedence order', async () => {
  const invalidPayloads = [
    ['vcs/tree-file', { commit: 'HEAD', path: '../x' }, 'Invalid historical file path.'],
    ['vcs/tree-history', { commit: A40, path: '../x', follow: 'yes' }, 'Invalid historical file path.'],
    ['vcs/revision-image', { base: 'HEAD', target: A40, id: A64, side: 'both' }, 'Invalid image side.'],
    ['vcs/revision-changes', { base: 'HEAD', target: '--all' }, 'Invalid revision commit id.'],
    ['vcs/revision-image', { base: A40, target: A40, id: 'bad', side: 'left' }, 'Invalid revision change id.'],
    ['vcs/revision-compare', { base: A40, target: A40, id: 'bad', large: 'yes' }, 'Invalid revision change id.'],
    ['vcs/commit-image', { commit: 'HEAD', id: 'bad' }, 'Invalid historical change id.'],
    ['vcs/commit-compare', { commit: 'HEAD', id: A64, large: 'yes' }, 'Invalid commit id.'],
    ['vcs/commit', { commit: A40, parentIndex: 101 }, 'Invalid parent index.'],
    ['vcs/blame', { commit: 'HEAD', id: A64, startLine: 0 }, 'Invalid commit id.'],
    ['vcs/blame', { commit: A40, id: A64, startLine: 0, lineLimit: 0 }, 'Invalid blame line window.'],
    ['vcs/compare', { id: '', large: 'yes' }, 'Invalid large comparison mode.'],
    ['vcs/tree-segment', { commit: A40, path: 'file.txt', offset: -1 }, 'Invalid segment offset.'],
    ['vcs/grep', { commit: 'HEAD', query: '' }, 'Invalid content search query.'],
    ['vcs/grep', { commit: 'HEAD', query: 'needle' }, 'Invalid content search commit.'],
    ['vcs/file-history', { commit: A40, id: A64, follow: 'yes', since: '2 weeks ago' }, 'Invalid rename follow mode.'],
    ['vcs/file-history', { commit: A40, id: A64, since: '2 weeks ago', offset: -1 }, 'Invalid history date bound.'],
    ['vcs/history', { search: { url: 'x' }, offset: -1 }, 'Invalid history search.'],
    ['vcs/history', { offset: null, snapshot: 'HEAD' }, 'Invalid history pagination.'],
    ['vcs/history', { offset: -1, limit: 0 }, 'Invalid history pagination.'],
    ['vcs/history', { snapshot: 'HEAD', limit: 101 }, 'Invalid history snapshot.'],
    ['vcs/workspace-image', { id: 'bad', mode: 'wrong' }, 'Invalid workspace image change id.'],
    ['vcs/conflict-stages', { id: 'bad', mode: 'wrong' }, 'Invalid workspace image change id.'],
    ['vcs/status', { mode: 'wrong' }, 'Unsupported comparison mode.'],
    ['vcs/compare', { id: '', mode: 'wrong' }, 'Unsupported comparison mode.'],
    ['vcs/workspace-image', { id: A64, mode: 'wrong' }, 'Unsupported comparison mode.'],
    ['vcs/compare', { id: '', mode: 'all' }, 'A change id is required.'],
  ];
  for (const [endpoint, fields, message] of invalidPayloads) {
    const result = await call(endpoint, { sessionId: 's', repositoryId: 'r', ...fields });
    assert.equal(result.error?.code, 'vcs/invalid-request', endpoint + ' ' + JSON.stringify(fields));
    assert.equal(result.error.message, message, endpoint + ' ' + JSON.stringify(fields));
  }
});

test('update endpoints stay field-free and reachable while reads are budgeted separately', async () => {
  const info = await call('vcs/runtime-info', {});
  assert.equal(info.ok, true);
  assert.equal(info.value.protocol, 1);
  const rejected = await call('vcs/runtime-info', { registry: 'https://evil.test' });
  assert.equal(rejected.error?.code, 'vcs/update-failed');
  assert.equal(rejected.error.message, 'Update requests accept no fields.');
  const aborted = new AbortController();
  aborted.abort();
  assert.equal((await call('vcs/check-update', {}, aborted.signal)).error.code, 'vcs/cancelled');
});
