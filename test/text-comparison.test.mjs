import test from 'node:test';
import assert from 'node:assert/strict';
import {alignLines, MAX_LCS_CELLS, MAX_DISPLAY_LINES} from '../src/text-comparison.mjs';

const kinds = result => result.rows.map(row => row.kind);
const many = (count, prefix) => Array.from({length: count}, (_, i) => prefix + i).join('\n');

test('equal lines retain exact text and one-based line numbers', () => {
  const result = alignLines('a\n<b>&', 'a\n<b>&');
  assert.deepEqual(kinds(result), ['equal', 'equal']);
  assert.deepEqual(result.rows[1], {kind: 'equal', left: {number: 2, text: '<b>&'}, right: {number: 2, text: '<b>&'}});
  assert.equal(result.approximate, false);
  assert.equal(result.truncated, false);
});

test('insertions and deletions align the shared suffix', () => {
  const added = alignLines('a\nc', 'a\nb\nc');
  assert.deepEqual(kinds(added), ['equal', 'insert', 'equal']);
  assert.equal(added.rows[1].left, null);
  assert.equal(added.rows[2].left.number, 2);
  assert.equal(added.rows[2].right.number, 3);
  const removed = alignLines('a\nb\nc', 'a\nc');
  assert.deepEqual(kinds(removed), ['equal', 'delete', 'equal']);
  assert.equal(removed.rows[1].right, null);
});

test('bounded LCS preserves interior equal lines between edits', () => {
  const result = alignLines('a\nb\nc\nd', 'x\nb\ny\nd');
  assert.deepEqual(kinds(result), ['delete', 'insert', 'equal', 'delete', 'insert', 'equal']);
  assert.equal(result.lcsCells, 16);
  assert.equal(result.approximate, false);
});

test('empty files have no phantom line and one-sided files remain exact', () => {
  assert.deepEqual(alignLines().rows, []);
  assert.deepEqual(kinds(alignLines('', 'a')), ['insert']);
  assert.deepEqual(kinds(alignLines('a', '')), ['delete']);
  assert.equal(alignLines('', many(3000, 'r')).approximate, false);
});

test('CRLF and CR are supported; trailing newline stays observable', () => {
  assert.deepEqual(kinds(alignLines('a\r\nb\r', 'a\nb\n')), ['equal', 'equal', 'equal']);
  assert.deepEqual(kinds(alignLines('a', 'a\n')), ['equal', 'insert']);
});

test('LCS allocation includes boundary cells and never exceeds the budget', () => {
  const exact = alignLines(many(399, 'l'), many(499, 'r'));
  assert.equal(exact.lcsCells, MAX_LCS_CELLS);
  assert.equal(exact.approximate, false);
  const approximate = alignLines(many(400, 'l'), many(499, 'r'));
  assert.equal(approximate.lcsCells, 0);
  assert.equal(approximate.approximate, true);
  assert.equal(approximate.rows[0].kind, 'replace');
  assert.equal(approximate.rows[400].kind, 'insert');
});

test('large comparisons use positional alignment and cap displayed rows', () => {
  const result = alignLines(many(10000, 'l'), many(10001, 'r'));
  assert.equal(result.approximate, true);
  assert.equal(result.rows.length, MAX_DISPLAY_LINES);
  assert.equal(result.totalRows, 10001);
  assert.equal(result.omittedRows, 8001);
  assert.equal(result.truncated, true);
  assert.equal(result.rows.at(-1).left.number, 2000);
});

test('large shared prefix and suffix avoid LCS and still report truncation', () => {
  const shared = many(2500, 'shared');
  const result = alignLines(shared + '\nold\ntail', shared + '\nnew\ntail');
  assert.equal(result.approximate, false);
  assert.equal(result.lcsCells, 4);
  assert.equal(result.rows.length, MAX_DISPLAY_LINES);
  assert.equal(result.truncated, true);
  assert.equal(result.totalRows, 2503);
  const equal = alignLines(shared, shared);
  assert.equal(equal.totalRows, 2500);
  assert.equal(equal.truncated, true);
});

test('exact small alignments reconstruct both inputs in order', () => {
  const samples = ['', 'a', 'a\nb', 'b\na', 'a\na\nb', 'x\nb\ny', '\n'];
  for (const before of samples) for (const after of samples) {
    const result = alignLines(before, after);
    for (const [side, input] of [['left', before], ['right', after]]) {
      const cells = result.rows.map(row => row[side]).filter(Boolean);
      assert.equal(cells.map(cell => cell.text).join('\n'), input);
      assert.deepEqual(cells.map(cell => cell.number), cells.map((_, i) => i + 1));
    }
    assert.ok(result.rows.every(row => row.kind !== 'equal' || row.left.text === row.right.text));
  }
});