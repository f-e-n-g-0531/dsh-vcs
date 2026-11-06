import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  createPartialIndexPlan as create, applyPartialIndexSelection as apply,
  MAX_PARTIAL_INDEX_BYTES, MAX_PARTIAL_INDEX_LINES, MAX_PARTIAL_INDEX_LCS_CELLS,
  PARTIAL_INDEX_ALGORITHM,
} from '../src/partial-index.mjs';

const b = text => Buffer.from(text, 'utf8');
const ids = plan => plan.units.map(unit => unit.id);
const clone = value => JSON.parse(JSON.stringify(value));
const rawLines = text => text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) || [];
const raw = tokens => tokens.map(token => token.text + ({LF: '\n', CRLF: '\r\n', CR: '\r', NONE: ''})[token.terminator]).join('');

function roundTrip(beforeText, afterText) {
  const before = b(beforeText), after = b(afterText), plan = create(before, after);
  assert.deepEqual(apply(before, after, plan, []), before);
  assert.deepEqual(apply(before, after, plan, ids(plan)), after);
  assert.deepEqual(create(Buffer.from(before), Buffer.from(after)), plan);
  assert.deepEqual(apply(before, after, clone(plan), ids(plan)), after);
  return plan;
}

for (const [name, before, after] of [
  ['LF', 'a\nb\nc\n', 'a\nx\nc\n'],
  ['CRLF', 'a\r\nb\r\n', 'a\r\nc\r\n'],
  ['CR', 'a\rb\rc\r', 'x\rb\ry\r'],
  ['mixed', 'a\r\nb\rc\nd', 'a\nx\rc\ny'],
  ['BOM and Unicode', '\ufeff雪\n😀\r\nz', '\ufeff雨\n😀\r\nx'],
  ['BOM addition', 'a\n', '\ufeffa\n'],
  ['BOM deletion', '\ufeffa\n', 'a\n'],
  ['missing final newline', 'a\nb', 'a\nb\n'],
  ['final newline removal', 'a\r\n', 'a'],
  ['empty', '', ''], ['equal', 'a\r\nb', 'a\r\nb'],
  ['add', '', 'a\nb'], ['delete', 'a\nb', ''],
  ['replace', 'a\nb\n', 'x\ny\n'],
  ['repeated', 'a\nb\na\nb\n', 'b\na\nb\na\n'],
  ['blank lines', '\n\r\n\r', '\r\n\n\r'],
]) test(name + ' round trips exact raw buffers', () => roundTrip(before, after));

test('display explicitly exposes raw endings and preserves BOM without phantom final line', () => {
  const plan = roundTrip('', '\ufeffa\r\nb\rc\nd');
  assert.equal(plan.beforeLineCount, 0);
  assert.equal(plan.afterLineCount, 4);
  assert.deepEqual(plan.units[0].after, [
    {text: '\ufeffa', terminator: 'CRLF'}, {text: 'b', terminator: 'CR'},
    {text: 'c', terminator: 'LF'}, {text: 'd', terminator: 'NONE'},
  ]);
  assert.equal(create(b(''), b('\n')).afterLineCount, 1);
  assert.equal(create(b(''), b('\ufeff')).afterLineCount, 1);
});

test('separated edit runs are atomic and subsets preserve untouched bytes', () => {
  const before = b('old1\r\nold2\rkeep\nremove\r\nanchor\ntail');
  const after = b('new1\nnew2\rkeep\nanchor\nend');
  const plan = create(before, after);
  assert.deepEqual(plan.units.map(u => [u.beforeStart, u.beforeCount, u.afterStart, u.afterCount]),
    [[0, 2, 0, 2], [3, 1, 3, 0], [5, 1, 4, 1]]);
  assert.equal(apply(before, after, plan, [plan.units[0].id]).toString(),
    'new1\nnew2\rkeep\nremove\r\nanchor\ntail');
  assert.equal(apply(before, after, plan, [plan.units[2].id, plan.units[1].id]).toString(),
    'old1\r\nold2\rkeep\nanchor\nend');
  assert.throws(() => apply(before, after, plan, [plan.units[0].before[0]]), TypeError);
});

test('IDs bind SHA256 input identity, algorithm, coordinates, and token contents', () => {
  const before = b('a\nk\na\n'), after = b('x\nk\nx\n'), plan = create(before, after);
  const hash = value => createHash('sha256').update(value).digest('hex');
  assert.equal(plan.beforeHash, hash(before));
  assert.equal(plan.afterHash, hash(after));
  assert.equal(plan.algorithm, PARTIAL_INDEX_ALGORITHM);
  assert.equal(plan.id, hash(JSON.stringify([plan.algorithm, plan.beforeHash, plan.afterHash])));
  assert.notEqual(plan.units[0].id, plan.units[1].id);
  for (const unit of plan.units) {
    assert.equal(unit.id, hash(JSON.stringify([plan.id,
      [unit.beforeStart, unit.beforeCount, unit.afterStart, unit.afterCount], unit.before, unit.after])));
  }
  const shifted = create(b('prefix\na\nk\na\n'), b('prefix\nx\nk\nx\n'));
  assert.notEqual(plan.id, shifted.id);
  assert.notEqual(plan.units[0].id, shifted.units[0].id);
});

test('plan is deeply immutable and buffers are copied synchronously with no alias', () => {
  const before = b('a\nk\nb'), after = b('x\nk\ny');
  const plan = create(before, after);
  function frozen(value) {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) frozen(child);
  }
  frozen(plan);
  assert.throws(() => { plan.units[0].after[0].text = 'bad'; }, TypeError);
  const retained = clone(plan);
  before.fill(122); after.fill(122);
  assert.deepEqual(plan, retained);
  for (const select of [[], ids(plan), [plan.units[0].id]]) {
    const original = b('a\nk\nb'), target = b('x\nk\ny');
    const result = apply(original, target, plan, select);
    result.fill(33);
    assert.equal(original.toString(), 'a\nk\nb');
    assert.equal(target.toString(), 'x\nk\ny');
  }
  const original = b('a'), target = b('x');
  const signal = {get aborted() { original.fill(122); target.fill(122); return false; }};
  const copied = create(original, target, {signal});
  assert.equal(copied.units[0].before[0].text, 'a');
  assert.equal(copied.units[0].after[0].text, 'x');
});

test('rejects stale inputs, every modified field, missing fields, and extras even with no selection', () => {
  const before = b('a\nk\nb'), after = b('x\nk\ny'), plan = create(before, after);
  for (const [left, right] of [[b('z\nk\nb'), after], [before, b('z\nk\ny')], [after, before]]) {
    assert.throws(() => apply(left, right, plan, []), /stale/);
  }
  function visit(value, path = []) {
    for (const key of Object.keys(value)) {
      const next = [...path, key];
      const tampered = clone(plan);
      let parent = tampered;
      for (const part of path) parent = parent[part];
      parent[key] = typeof value[key] === 'number' ? value[key] + 1 : 'tampered';
      assert.throws(() => apply(before, after, tampered, []), /plan/, next.join('.'));
      const missing = clone(plan);
      let owner = missing;
      for (const part of path) owner = owner[part];
      delete owner[key];
      assert.throws(() => apply(before, after, missing, []), /plan/);
      if (value[key] && typeof value[key] === 'object') visit(value[key], next);
    }
  }
  visit(plan);
  for (const mutate of [
    p => { p.extra = 1; }, p => { p.units.extra = 1; },
    p => { p.units[0].after[0].extra = 1; }, p => { p[Symbol('extra')] = 1; },
    p => { p.units.reverse(); }, p => { p.units[0].beforeStart = -0; },
    p => { Object.setPrototypeOf(p, {evil: true}); },
    p => { Object.defineProperty(p, 'id', {get() { throw Error('getter executed'); }}); },
  ]) {
    const tampered = clone(plan); mutate(tampered);
    assert.throws(() => apply(before, after, tampered, []), /plan/);
  }
});

test('selection must contain unique known string IDs', () => {
  const before = b('a'), after = b('x'), plan = create(before, after), id = plan.units[0].id;
  for (const selection of [undefined, null, {}, new Set([id]), 'id', [id, id], ['unknown'], [1], [null], Array(1)]) {
    assert.throws(() => apply(before, after, plan, selection), TypeError);
  }
  const other = create(b('other'), after);
  assert.throws(() => apply(before, after, plan, ids(other)), /Unknown/);
});

test('cancellation rejects create and apply, including none/all, and checks during work', () => {
  const before = b('a\nk\nb'), after = b('x\nk\ny'), plan = create(before, after);
  const controller = new AbortController(); controller.abort();
  const abort = {name: 'AbortError'};
  assert.throws(() => create(before, after, {signal: controller.signal}), abort);
  for (const selection of [[], ids(plan), [plan.units[0].id]]) {
    assert.throws(() => apply(before, after, plan, selection, {signal: controller.signal}), abort);
  }
  for (const limit of [2, 10, 30, 70]) {
    let checks = 0;
    const signal = {get aborted() { return ++checks > limit; }};
    assert.throws(() => create(b('a\n'.repeat(100)), b('b\n'.repeat(100)), {signal}), abort);
  }
  let checks = 0;
  assert.throws(() => apply(before, after, plan, [], {signal: {get aborted() { return ++checks > 35; }}}), abort);
});

test('strict UTF-8 and conservative binary rejection applies to both sides and empty selection', () => {
  for (const invalid of [Buffer.from([0]), Buffer.from([1]), Buffer.from([127]),
    Buffer.from([0xff]), Buffer.from([0xc0, 0xaf]), Buffer.from([0xe2, 0x82]),
    Buffer.from([0xed, 0xa0, 0x80]), Buffer.from([0xff, 0xfe, 65, 0])]) {
    assert.throws(() => create(invalid, b('a')), TypeError);
    assert.throws(() => create(b('a'), invalid), TypeError);
    assert.throws(() => apply(invalid, b('a'), {}, []), TypeError);
  }
  for (const invalid of ['a', new Uint8Array([65]), null]) assert.throws(() => create(invalid, b('a')), TypeError);
  roundTrip('\t😀雪\n', '\t雨😀\n');
});

test('inclusive byte and raw-line limits apply independently to both inputs', () => {
  assert.equal(MAX_PARTIAL_INDEX_BYTES, 262144);
  assert.equal(MAX_PARTIAL_INDEX_LINES, 4000);
  const maxBytes = Buffer.alloc(MAX_PARTIAL_INDEX_BYTES, 97);
  assert.equal(create(maxBytes, maxBytes).beforeBytes, MAX_PARTIAL_INDEX_BYTES);
  assert.equal(create(b(''), maxBytes).units.length, 1);
  for (const oversized of [Buffer.alloc(MAX_PARTIAL_INDEX_BYTES + 1, 97), b('a\n'.repeat(4001)), b('a\n'.repeat(4000) + 'z')]) {
    assert.throws(() => create(oversized, b('')), RangeError);
    assert.throws(() => create(b(''), oversized), RangeError);
  }
  for (const ending of ['\n', '\r', '\r\n']) {
    const maximum = b(('a' + ending).repeat(4000));
    assert.equal(create(b(''), maximum).afterLineCount, 4000);
    assert.equal(create(maximum, maximum).units.length, 0);
  }
});

test('exact LCS boundary cells are budgeted; prefix/suffix and one-sided work need no fallback', () => {
  assert.equal(MAX_PARTIAL_INDEX_LCS_CELLS, 200000);
  const rows = (count, prefix) => b(Array.from({length: count}, (_, i) => prefix + i + '\n').join(''));
  const left = rows(399, 'l'), right = rows(499, 'r');
  assert.equal(create(left, right).lcsCells, 200000);
  assert.throws(() => create(rows(400, 'l'), right), /200000/);
  assert.throws(() => apply(rows(400, 'l'), right, {}, []), /200000/);
  const prefix = b('p\n'.repeat(1900)), suffix = b('s\n'.repeat(1900));
  const small = create(Buffer.concat([prefix, b('a\n'), suffix]), Buffer.concat([prefix, b('b\n'), suffix]));
  assert.equal(small.lcsCells, 4);
  assert.equal(small.units[0].beforeStart, 1900);
  assert.equal(create(b(''), rows(4000, 'r')).lcsCells, 0);
  assert.equal(create(rows(4000, 'l'), b('')).lcsCells, 0);
});

// Independent exhaustive oracle: recursive exact LCS length plus direct raw
// string slicing for ALL subsets. This verifies optimality and unit coverage,
// not merely all-selection fast paths or the implementation's own token data.
function lcs(a, c, i = 0, j = 0) {
  if (i === a.length || j === c.length) return 0;
  return a[i] === c[j] ? 1 + lcs(a, c, i + 1, j + 1)
    : Math.max(lcs(a, c, i + 1, j), lcs(a, c, i, j + 1));
}
function sequences(alphabet, maxLength) {
  const result = [''];
  let level = [''];
  for (let size = 1; size <= maxLength; size++) {
    level = level.flatMap(prefix => alphabet.map(token => prefix + token));
    result.push(...level);
  }
  return result;
}

test('exhaustive small repeated/mixed-ending sequences: exact LCS, deterministic units, every subset', () => {
  const samples = sequences(['a\n', 'b\r\n', 'c\r'], 3);
  samples.push('a', 'b', '\ufeffa', 'a\na', 'a\nb', 'b\r\na');
  let cases = 0, subsets = 0;
  for (const beforeText of samples) for (const afterText of samples) {
    const before = b(beforeText), after = b(afterText), plan = create(before, after);
    assert.deepEqual(create(before, after), plan);
    const a = rawLines(beforeText), c = rawLines(afterText);
    let bi = 0, ai = 0, removed = 0, added = 0;
    for (const unit of plan.units) {
      assert.deepEqual(a.slice(bi, unit.beforeStart), c.slice(ai, unit.afterStart));
      if (bi || ai) assert.ok(unit.beforeStart > bi && unit.afterStart > ai);
      assert.equal(raw(unit.before), a.slice(unit.beforeStart, unit.beforeStart + unit.beforeCount).join(''));
      assert.equal(raw(unit.after), c.slice(unit.afterStart, unit.afterStart + unit.afterCount).join(''));
      assert.ok(unit.beforeCount + unit.afterCount > 0);
      bi = unit.beforeStart + unit.beforeCount; ai = unit.afterStart + unit.afterCount;
      removed += unit.beforeCount; added += unit.afterCount;
    }
    assert.deepEqual(a.slice(bi), c.slice(ai));
    assert.equal(removed + added, a.length + c.length - 2 * lcs(a, c));
    for (let mask = 0; mask < 2 ** plan.units.length; mask++) {
      const selected = plan.units.filter((_, i) => mask & (1 << i));
      let cursor = 0, expected = '';
      for (const unit of selected) {
        expected += a.slice(cursor, unit.beforeStart).join('') + c.slice(unit.afterStart, unit.afterStart + unit.afterCount).join('');
        cursor = unit.beforeStart + unit.beforeCount;
      }
      expected += a.slice(cursor).join('');
      assert.deepEqual(apply(before, after, plan, selected.map(u => u.id).reverse()), b(expected));
      if (!mask) assert.equal(expected, beforeText);
      if (mask === 2 ** plan.units.length - 1) assert.equal(expected, afterText);
      subsets++;
    }
    cases++;
  }
  assert.equal(cases, 2116);
  assert.ok(subsets > cases);
});
