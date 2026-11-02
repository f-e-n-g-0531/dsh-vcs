import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../index.mjs';

const commit = 'a'.repeat(40);
function fixture(type = 'git', options = {}) {
  const repo = {id: 'r', type, root: '/fixture'};
  let cwd = '/fixture', count = 0; const cleared = [];
  const handler = createHandler({sessions: {get: () => ({header: {cwd}})}}, {
    discoverRepositories: async () => ({repositories: [repo], warnings: []}),
    getHistoricalTreePage: async (selected, request) => {count++; assert.deepEqual(selected, repo); return {commit: request.commit, path: request.path, entries: [], nextOffset: null};},
    clearHistoricalCache: root => cleared.push(root),
  }, 4, options);
  return {handler, cleared, count: () => count, setCwd: value => cwd = value};
}

test('tree page requires a current Session grant and immutable commit', async () => {
  const f = fixture(); const body = {sessionId: 's', repositoryId: 'r', commit};
  assert.equal((await f.handler('vcs/tree-page', body)).error.code, 'vcs/rediscover-required');
  await f.handler('vcs/repositories', {sessionId: 's'});
  assert.deepEqual((await f.handler('vcs/tree-page', body)).value, {commit, path: '', entries: [], nextOffset: null});
  assert.equal((await f.handler('vcs/tree-page', {...body, path: '中文 dir', offset: 100, limit: 20})).ok, true);
  for (const extra of [{path: '../x'}, {path: '/x'}, {path: 'x//y'}, {path: null}, {commit: 'HEAD'}, {offset: -1}, {offset: null}, {limit: 101}, {root: '/other'}]) {
    assert.equal((await f.handler('vcs/tree-page', {...body, ...extra})).error.code, 'vcs/invalid-request', JSON.stringify(extra));
  }
  assert.equal(f.count(), 2);
  f.setCwd('/different');
  assert.equal((await f.handler('vcs/tree-page', body)).error.code, 'vcs/rediscover-required');
  assert.deepEqual(f.cleared, ['/fixture']);
});

test('grant expiry and replacement clear historical cache; SVN cannot use tree page', async () => {
  let now = 0; const f = fixture('git', {now: () => now, ttlMs: 10});
  await f.handler('vcs/repositories', {sessionId: 's'});
  await f.handler('vcs/repositories', {sessionId: 's'});
  assert.deepEqual(f.cleared, ['/fixture']);
  now = 11;
  assert.equal((await f.handler('vcs/tree-page', {sessionId: 's', repositoryId: 'r', commit})).error.code, 'vcs/rediscover-required');
  assert.deepEqual(f.cleared, ['/fixture', '/fixture']);
  const svn = fixture('svn'); await svn.handler('vcs/repositories', {sessionId: 's'});
  assert.equal((await svn.handler('vcs/tree-page', {sessionId: 's', repositoryId: 'r', commit})).error.code, 'vcs/invalid-request');
  assert.equal(svn.count(), 0);
});
