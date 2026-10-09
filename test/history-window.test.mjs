import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeHistoryWindow} from '../src/history-window.mjs';

const rows = (start, count) => Array.from({length: count}, (_, i) => ({id: String(start + i)}));

test('history window resets on first page and retains authoritative page metadata', () => {
  const previous = {commits: rows(0, 50)};
  const incoming = {commits: rows(100, 2), snapshot: 'fixed', nextOffset: null};
  const result = mergeHistoryWindow(previous, incoming, 0);
  assert.deepEqual(result, {...incoming, windowEnd: 2});
  assert.equal(previous.commits.length, 50);
});

test('history window replaces overlap and retains newest 200 loaded rows', () => {
  const previous = {commits: rows(0, 200)};
  const incoming = {commits: rows(190, 50), snapshot: 'fixed', nextOffset: 250};
  const result = mergeHistoryWindow(previous, incoming, 200);
  assert.equal(result.commits.length, 200);
  assert.equal(result.commits[0].id, '40');
  assert.equal(result.commits.at(-1).id, '239');
  assert.equal(new Set(result.commits.map(row => row.id)).size, 200);
  assert.equal(result.windowEnd, 250);
  assert.equal(result.snapshot, 'fixed');
  assert.equal(result.nextOffset, 250);
  assert.equal(previous.commits.length, 200);
  assert.equal(incoming.commits.length, 50);
});
