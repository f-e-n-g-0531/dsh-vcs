import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createLineIndexPlan as create, applyLineIndexSelection as apply,
  LINE_INDEX_ALGORITHM} from '../src/line-index.mjs';
import {createPartialIndexPlan} from '../src/partial-index.mjs';

const b = text => Buffer.from(text, 'utf8');
const ids = plan => plan.operations.map(operation => operation.id);
const clone = value => JSON.parse(JSON.stringify(value));
const lines = text => text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) || [];
const hash = value => createHash('sha256').update(value).digest('hex');

function subsets(plan, check) {
  for (let mask = 0; mask < 2 ** plan.operations.length; mask++) {
    const chosen = plan.operations.filter((_, i) => mask & (2 ** i));
    check(chosen, mask);
  }
}

function frozen(value) {
  if (!value || typeof value !== 'object') return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) frozen(child);
}

// Independent small-input oracle: enumerate all monotone common subsequences,
// then walk the optimal path with delete-first ties. No production plan, units,
// operations, tokenization, or dynamic-programming table are used.
function oracleRuns(before, after) {
  const a = lines(before), z = lines(after);
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < z.length && a[prefix] === z[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < z.length - prefix &&
    a[a.length - 1 - suffix] === z[z.length - 1 - suffix]) suffix++;
  const endA = a.length - suffix, endZ = z.length - suffix;
  function longest(i, j) {
    let best = 0;
    for (let x = i; x < endA; x++) for (let y = j; y < endZ; y++) {
      if (a[x] === z[y]) best = Math.max(best, 1 + longest(x + 1, y + 1));
    }
    return best;
  }
  const runs = [];
  let i = prefix, j = prefix, run;
  while (i < endA || j < endZ) {
    if (i < endA && j < endZ && a[i] === z[j]) {
      run = undefined; i++; j++;
    } else {
      if (!run) { run = {start: i, removed: [], added: []}; runs.push(run); }
      if (i < endA && (j === endZ || longest(i + 1, j) >= longest(i, j + 1))) {
        run.removed.push({line: i, raw: a[i++]});
      } else run.added.push({line: j, raw: z[j++]});
    }
  }
  return {a, runs};
}

function oracleApply(oracle, chosen) {
  const deletes = new Set(chosen.filter(o => o.kind === 'delete').map(o => o.beforeLine));
  const inserts = new Set(chosen.filter(o => o.kind === 'insert').map(o => o.afterLine));
  const result = [];
  let cursor = 0;
  for (const run of oracle.runs) {
    while (cursor < run.start) result.push(oracle.a[cursor++]);
    for (const old of run.removed) {
      if (!deletes.has(old.line)) result.push(old.raw);
      cursor++;
    }
    for (const added of run.added) if (inserts.has(added.line)) result.push(added.raw);
  }
  result.push(...oracle.a.slice(cursor));
  const output=result.join('');
  if(JSON.stringify(lines(output))!==JSON.stringify(result))throw new RangeError('Unsafe oracle token boundary');
  return b(output);
}

test('every individual operation and all 32 subsets of 2old -> 3new replacement', () => {
  const before = b('prefix\nold1\nold2\nkeep\ntail');
  const after = b('prefix\nnew1\nnew2\nnew3\nkeep\ntail');
  const plan = create(before, after);
  assert.equal(plan.units.length, 1);
  assert.deepEqual(plan.operations.map(o => [o.kind, o.beforeLine, o.afterLine, o.unitOffset]), [
    ['delete', 1, undefined, 0], ['delete', 2, undefined, 1],
    ['insert', undefined, 1, 0], ['insert', undefined, 2, 1], ['insert', undefined, 3, 2],
  ]);
  const expected = [
    'prefix\nold2\nkeep\ntail', 'prefix\nold1\nkeep\ntail',
    'prefix\nold1\nold2\nnew1\nkeep\ntail',
    'prefix\nold1\nold2\nnew2\nkeep\ntail',
    'prefix\nold1\nold2\nnew3\nkeep\ntail',
  ];
  plan.operations.forEach((operation, i) => {
    assert.equal(apply(before, after, plan, [operation.id]).toString(), expected[i]);
  });
  subsets(plan, chosen => {
    const old = ['old1\n', 'old2\n'].filter((_, i) => !chosen.includes(plan.operations[i]));
    const added = ['new1\n', 'new2\n', 'new3\n'].filter((_, i) => chosen.includes(plan.operations[i + 2]));
    const expectedBytes = b('prefix\n' + old.join('') + added.join('') + 'keep\ntail');
    assert.deepEqual(apply(before, after, plan, chosen.map(o => o.id).reverse()), expectedBytes);
  });
});

for (const [name, beforeText, afterText] of [
  ['mixed endings and BOM', '\ufeff雪\r\nold\rkeep\nlast', '\ufeff雨\nnew\rkeep\nend\r\n'],
  ['BOM addition', 'a\n', '\ufeffa\n'], ['BOM removal', '\ufeffa', 'a'],
  ['empty', '', ''], ['equal', '😀\r\nx', '😀\r\nx'],
  ['addition', '', 'a\nb'], ['deletion', 'a\nb', ''],
  ['repeated', 'a\nb\na\n', 'b\na\nb\n'],
  ['multiple runs', 'a\nkeep\nb\nanchor\nc', 'x\nkeep\ny\nanchor\nz'],
  ['EOF newline addition', 'a', 'a\n'], ['EOF newline removal', 'a\r\n', 'a'],
]) test(name + ': every subset preserves exact raw bytes', () => {
  const before = b(beforeText), after = b(afterText), plan = create(before, after);
  const oracle = oracleRuns(beforeText, afterText);
  subsets(plan, chosen => {let expected;try{expected=oracleApply(oracle,chosen);}catch{assert.throws(()=>apply(before,after,plan,chosen.map(o=>o.id)),/merge raw line boundaries/);return;}assert.deepEqual(apply(before,after,plan,chosen.map(o=>o.id)),expected);});
  assert.deepEqual(apply(before, after, plan, []), before);
  assert.deepEqual(apply(before, after, clone(plan), ids(plan)), after);
});

test('literal EOF joins, terminator changes, CRLF joining, and interior BOM are explicit', () => {
  function select(beforeText, afterText, kind) {
    const before = b(beforeText), after = b(afterText), plan = create(before, after);
    return apply(before, after, plan, plan.operations.filter(o => o.kind === kind).map(o => o.id)).toString();
  }
  assert.throws(()=>select('old', 'new\n', 'insert'), /merge raw line boundaries/);
  assert.equal(select('a\n', 'a', 'delete'), '');
  assert.equal(select('a\n', 'a', 'insert'), 'a\na');
  assert.throws(()=>select('a', 'a\n', 'insert'), /merge raw line boundaries/);
  assert.throws(()=>select('\r', '\n', 'insert'), /merge raw line boundaries/);
  assert.throws(()=>select('old', '\ufeffnew', 'insert'), /merge raw line boundaries/);
});

test('stable IDs bind inputs, complete source units, direction, and offsets', () => {
  const before = b('a\na\n'), after = b('x\nx\ny\n'), plan = create(before, after);
  const source = createPartialIndexPlan(before, after);
  assert.equal(plan.algorithm, LINE_INDEX_ALGORITHM);
  assert.equal(plan.sourceAlgorithm, source.algorithm);
  assert.equal(plan.id, hash(JSON.stringify([LINE_INDEX_ALGORITHM, source.id])));
  assert.equal(plan.beforeHash, hash(before)); assert.equal(plan.afterHash, hash(after));
  assert.deepEqual(plan.units, source.units);
  assert.equal(new Set(ids(plan)).size, plan.operations.length);
  for (const operation of plan.operations) {
    assert.equal(operation.unitId, source.units[0].id);
    assert.equal(operation.id, hash(JSON.stringify([plan.id, operation.unitId, operation.kind, operation.unitOffset])));
  }
  assert.deepEqual(create(before, after), plan);
  assert.deepEqual(create(Buffer.from(before), Buffer.from(after)), plan);
  for (const changed of [create(before, b('x\nx\nz\n')), create(b('prefix\na\na\n'), b('prefix\nx\nx\ny\n')), create(after, before)]) {
    assert.notEqual(changed.id, plan.id);
    assert.ok(ids(changed).every(id => !ids(plan).includes(id)));
  }
  frozen(plan);
  const saved = clone(plan);
  before.fill(120); after.fill(120);
  assert.deepEqual(plan, saved);
});

test('returns independent Buffers for none, all, and synthetic selections', () => {
  const before = b('old\n'), after = b('new\n'), plan = create(before, after);
  for (const selection of [[], ids(plan), [plan.operations[1].id]]) {
    const result = apply(before, after, plan, selection);
    result.fill(0);
    assert.equal(before.toString(), 'old\n'); assert.equal(after.toString(), 'new\n');
  }
});

test('validates whole plan including unselected operations and source units', () => {
  const before = b('old\n'), after = b('new\n'), plan = create(before, after);
  const mutations = [
    p => { p.algorithm = 'other'; }, p => { p.id = 'other'; },
    p => { p.beforeHash = 'other'; }, p => { p.afterBytes++; },
    p => { p.operations[1].text = 'tampered'; }, p => { p.operations[0].unitOffset++; },
    p => { p.operations[0].kind = 'insert'; }, p => { p.operations[1].terminator = 'CR'; },
    p => { p.operations.reverse(); }, p => { p.operations.pop(); },
    p => { p.units[0].after[0].text = 'tampered'; }, p => { p.units[0].beforeStart++; },
    p => { p.extra = true; }, p => { p.operations[0].extra = true; },
    p => { p[Symbol('extra')] = true; }, p => { delete p.operations[0]; },
    p => { Object.defineProperty(p.operations, 'extra', {value: true}); },
    p => { Object.setPrototypeOf(p, Date.prototype); },
    p => { Object.defineProperty(p, 'id', {value: p.id, enumerable: false}); },
  ];
  for (const mutate of mutations) {
    const invalid = clone(plan); mutate(invalid);
    assert.throws(() => apply(before, after, invalid, []), TypeError);
    assert.throws(() => apply(before, after, invalid, ids(plan)), TypeError);
  }
  assert.throws(() => apply(b('OLD\n'), after, plan, []), /stale/);
  const nullPrototype = Object.assign(Object.create(null), clone(plan));
  assert.deepEqual(apply(before, after, nullPrototype, ids(plan)), after);
});

test('rejects plan and selection accessors without evaluating them', () => {
  const before = b('old\n'), after = b('new\n'), plan = create(before, after);
  let calls = 0;
  for (const path of [[], ['operations', 1], ['units', 0, 'after', 0]]) {
    const invalid = clone(plan);
    let object = invalid;
    for (const key of path) object = object[key];
    const key = path.length ? 'text' : 'id';
    Object.defineProperty(object, key, {enumerable: true, get() { calls++; throw new Error('getter ran'); }});
    assert.throws(() => apply(before, after, invalid, []), TypeError);
  }
  const selection = [plan.operations[0].id];
  Object.defineProperty(selection, '0', {enumerable: true, get() { calls++; throw new Error('getter ran'); }});
  assert.throws(() => apply(before, after, plan, selection), TypeError);
  assert.equal(calls, 0);
});

test('rejects unknown, duplicate, sparse, extra-field, and non-array selections', () => {
  const before = b('old\n'), after = b('new\n'), plan = create(before, after), id = ids(plan)[0];
  const extra = [id]; extra.extra = true;
  const symbol = [id]; symbol[Symbol('extra')] = true;
  const iterator = [id]; iterator[Symbol.iterator] = () => { throw new Error('iterator ran'); };
  for (const invalid of [null, {}, new Set([id]), 'id', ['unknown'], [id, id], [5], [plan.operations[0]], new Array(1), extra, symbol, iterator]) {
    assert.throws(() => apply(before, after, plan, invalid), TypeError);
  }
});

test('enforces input Buffer, UTF-8, ASCII control, byte, line, and exact cell limits', () => {
  for (const invalid of ['text', new Uint8Array([65]), null]) assert.throws(() => create(invalid, b('')), TypeError);
  for (const invalid of [Buffer.from([0xc3]), Buffer.from([0xff]), b('a\0b'), b('a\x01b'), b('a\x7fb')]) {
    assert.throws(() => create(invalid, b('')), TypeError);
    assert.throws(() => create(b(''), invalid), TypeError);
  }
  assert.throws(() => create(b('x'.repeat(262145)), b('')), /256 KiB/);
  assert.throws(() => create(b(''), b('x'.repeat(262145))), /256 KiB/);
  assert.equal(create(b('x'.repeat(262144)), b('')).beforeBytes, 262144);
  assert.throws(() => create(b('x\n'.repeat(4001)), b('')), /4000 lines/);
  assert.equal(create(b('x\n'.repeat(4000)), b('')).beforeLineCount, 4000);
  assert.equal(create(b('a\n'.repeat(446)), b('b\n'.repeat(446))).lcsCells, 199809);
  assert.throws(() => create(b('a\n'.repeat(447)), b('b\n'.repeat(447))), /200000 cells/);
});

test('candidate byte overflow explicitly fails while none/all remain exact', () => {
  const before = b('a'.repeat(131072) + '\n'), after = b('b'.repeat(131072) + '\n');
  const plan = create(before, after), insert = plan.operations.find(o => o.kind === 'insert');
  assert.throws(() => apply(before, after, plan, [insert.id]), /Candidate exceeds 256 KiB/);
  assert.deepEqual(apply(before, after, plan, []), before);
  assert.deepEqual(apply(before, after, plan, ids(plan)), after);
  const boundaryBefore = b('a'.repeat(131071) + '\n'), boundaryAfter = b('b'.repeat(131071) + '\n');
  const boundary = create(boundaryBefore, boundaryAfter);
  assert.equal(apply(boundaryBefore, boundaryAfter, boundary, [boundary.operations[1].id]).length, 262144);
});

test('candidate actual raw-line overflow fails, and CRLF joins do not overcount', () => {
  const common = 'k\n'.repeat(3999), before = b(common + 'old\n'), after = b(common + 'new\n');
  const plan = create(before, after);
  assert.throws(() => apply(before, after, plan, [plan.operations[1].id]), /4000 lines/);
  const joinBefore = b(common + '\r'), joinAfter = b(common + '\n'), joined = create(joinBefore, joinAfter);
  assert.throws(()=>apply(joinBefore, joinAfter, joined, [joined.operations[1].id]), /merge raw line boundaries/);
});

test('pre-cancelled and cooperative in-flight cancellation throws AbortError', () => {
  const before = b('old\n'), after = b('new\n'), plan = create(before, after);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => create(before, after, {signal: controller.signal}), {name: 'AbortError'});
  assert.throws(() => apply(before, after, plan, [], {signal: controller.signal}), {name: 'AbortError'});
  let totalChecks = 0;
  apply(before, after, plan, [plan.operations[1].id], {signal: {get aborted() { totalChecks++; return false; }}});
  for (const threshold of [1, 20, totalChecks - 1, totalChecks]) {
    let checks = 0;
    const signal = {get aborted() { return ++checks >= threshold; }};
    assert.throws(() => apply(before, after, plan, [plan.operations[1].id], {signal}), {name: 'AbortError'});
  }
});

test('independent exhaustive oracle: all small raw-input pairs and every operation subset', () => {
  const alphabet = ['a\n', 'b\r\n', '\r', '😀'];
  const samples = ['', ...alphabet];
  for (const a of alphabet) for (const z of alphabet) samples.push(a + z);
  let pairs = 0, selections = 0;
  for (const beforeText of samples) for (const afterText of samples) {
    const before = b(beforeText), after = b(afterText), plan = create(before, after);
    const oracle = oracleRuns(beforeText, afterText);
    const expectedOperations = oracle.runs.flatMap(run => [
      ...run.removed.map(o => ['delete', o.line]), ...run.added.map(o => ['insert', o.line]),
    ]);
    assert.deepEqual(plan.operations.map(o => [o.kind, o.beforeLine ?? o.afterLine]), expectedOperations);
    subsets(plan, chosen => {
      let expected;try{expected=oracleApply(oracle,chosen);}catch{assert.throws(()=>apply(before,after,plan,chosen.map(o=>o.id)),/merge raw line boundaries/);selections++;return;}
      assert.deepEqual(apply(before, after, plan, chosen.map(o => o.id)), expected);
      selections++;
    });
    pairs++;
  }
  assert.equal(pairs, 441);
  assert.ok(selections > 2000);
});
