import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';

export const MAX_PARTIAL_INDEX_BYTES = 256 * 1024;
export const MAX_PARTIAL_INDEX_LINES = 4000;
export const MAX_PARTIAL_INDEX_LCS_CELLS = 200000;
export const PARTIAL_INDEX_ALGORITHM = 'raw-line-lcs-v1';

function checkAbort(signal) {
  if (signal?.aborted) {
    const error = new Error('Partial index operation aborted');
    error.name = 'AbortError';
    throw error;
  }
}

function snapshot(value, label) {
  if (!Buffer.isBuffer(value)) throw new TypeError(label + ' must be a Buffer');
  if (value.length > MAX_PARTIAL_INDEX_BYTES) throw new RangeError(label + ' exceeds 256 KiB');
  return Buffer.from(value);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

// No newline normalization, synthetic trailing line, or BOM removal. Strings
// re-encode losslessly because decoding is fatal and ignoreBOM preserves U+FEFF.
function tokenize(buffer, signal) {
  for (let i = 0; i < buffer.length; i++) {
    if ((i & 1023) === 0) checkAbort(signal);
    const byte = buffer[i];
    if ((byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) || byte === 127) {
      throw new TypeError('Binary text is unsupported (NUL or ASCII control byte)');
    }
  }
  let text;
  try {
    text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(buffer);
  } catch {
    throw new TypeError('Partial index requires valid UTF-8');
  }
  const lines = [];
  let start = 0;
  function push(end, next, terminator) {
    if (lines.length >= MAX_PARTIAL_INDEX_LINES) throw new RangeError('Input exceeds 4000 lines');
    lines.push(Object.freeze({text: text.slice(start, end), terminator}));
    start = next;
  }
  for (let i = 0; i < text.length; i++) {
    if ((i & 1023) === 0) checkAbort(signal);
    if (text[i] === '\r') {
      const crlf = text[i + 1] === '\n';
      push(i, i + (crlf ? 2 : 1), crlf ? 'CRLF' : 'CR');
      if (crlf) i++;
    } else if (text[i] === '\n') push(i, i + 1, 'LF');
  }
  if (start < text.length) push(text.length, text.length, 'NONE');
  return lines;
}

function sameLine(a, b) {
  return a.text === b.text && a.terminator === b.terminator;
}

function buildPlan(before, after, signal) {
  checkAbort(signal);
  const left = tokenize(before, signal), right = tokenize(after, signal);
  const beforeHash = sha256(before), afterHash = sha256(after);
  const id = sha256(JSON.stringify([PARTIAL_INDEX_ALGORITHM, beforeHash, afterHash]));
  let prefix = 0, suffix = 0;
  while (prefix < left.length && prefix < right.length && sameLine(left[prefix], right[prefix])) {
    checkAbort(signal);
    prefix++;
  }
  while (suffix < left.length - prefix && suffix < right.length - prefix &&
    sameLine(left[left.length - suffix - 1], right[right.length - suffix - 1])) {
    checkAbort(signal);
    suffix++;
  }
  const n = left.length - prefix - suffix, m = right.length - prefix - suffix;
  const lcsCells = n && m ? (n + 1) * (m + 1) : 0;
  if (lcsCells > MAX_PARTIAL_INDEX_LCS_CELLS) throw new RangeError('Exact LCS exceeds 200000 cells');
  const width = m + 1, dp = new Uint16Array(lcsCells);
  for (let i = n - 1; i >= 0 && m; i--) {
    checkAbort(signal);
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = sameLine(left[prefix + i], right[prefix + j])
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const units = [];
  let i = 0, j = 0, run = null;
  function flush() {
    if (!run) return;
    const beforeStart = prefix + run.i, afterStart = prefix + run.j;
    const beforeCount = i - run.i, afterCount = j - run.j;
    const beforeLines = Object.freeze(left.slice(beforeStart, beforeStart + beforeCount));
    const afterLines = Object.freeze(right.slice(afterStart, afterStart + afterCount));
    const coordinates = [beforeStart, beforeCount, afterStart, afterCount];
    const unitId = sha256(JSON.stringify([id, coordinates, beforeLines, afterLines]));
    units.push(Object.freeze({id: unitId, beforeStart, beforeCount, afterStart, afterCount,
      before: beforeLines, after: afterLines}));
    run = null;
  }
  while (i < n || j < m) {
    checkAbort(signal);
    if (i < n && j < m && sameLine(left[prefix + i], right[prefix + j])) {
      flush();
      i++;
      j++;
    } else {
      if (!run) run = {i, j};
      // Deterministic ties delete first. Consecutive deletes/inserts form one
      // atomic replacement; only an equal raw line separates edit units.
      if (i < n && (j === m || dp[(i + 1) * width + j] >= dp[i * width + j + 1])) i++;
      else j++;
    }
  }
  flush();
  checkAbort(signal);
  return Object.freeze({id, algorithm: PARTIAL_INDEX_ALGORITHM, beforeHash, afterHash,
    beforeBytes: before.length, afterBytes: after.length,
    beforeLineCount: left.length, afterLineCount: right.length, lcsCells,
    units: Object.freeze(units)});
}

/** Pure synchronous model; no filesystem, RPC, index mutation, or retained buffers.
 * Starts are zero-based raw-line indices. Each unit's before/after arrays contain
 * frozen {text, terminator: 'LF'|'CRLF'|'CR'|'NONE'} display tokens. A BOM stays
 * in the first text token. Empty input has zero tokens, not a phantom line.
 * Inputs: Buffers, <=256 KiB and <=4000 raw lines each, fatal UTF-8, no ASCII
 * controls except TAB/LF/CR. Exact LCS after common prefix/suffix uses <=200000
 * cells INCLUDING boundaries (zero cells for a one-sided middle); otherwise
 * throws RangeError, never an approximate plan. Returns deeply frozen data.
 */
export function createPartialIndexPlan(beforeBuffer, afterBuffer, {signal} = {}) {
  const before = snapshot(beforeBuffer, 'before'), after = snapshot(afterBuffer, 'after');
  return buildPlan(before, after, signal);
}

// Compare every own field, including arrays' length, without evaluating supplied
// getters. A serializable plain-data copy is accepted; extra/symbol/accessor
// fields, sparse arrays, exotic prototypes, and any changed value are rejected.
function canonicalEqual(supplied, expected, signal) {
  checkAbort(signal);
  if (expected === null || typeof expected !== 'object') return Object.is(supplied, expected);
  if (supplied === null || typeof supplied !== 'object' || Array.isArray(supplied) !== Array.isArray(expected)) return false;
  const prototype = Object.getPrototypeOf(supplied);
  if (Array.isArray(expected) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(expected), suppliedKeys = Reflect.ownKeys(supplied);
  if (keys.length !== suppliedKeys.length) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(supplied, key);
    return descriptor && Object.hasOwn(descriptor, 'value') &&
      descriptor.enumerable === Object.getOwnPropertyDescriptor(expected, key).enumerable &&
      canonicalEqual(descriptor.value, expected[key], signal);
  });
}

const endings = Object.freeze({LF: '\n', CRLF: '\r\n', CR: '\r', NONE: ''});
function encode(lines) {
  return Buffer.from(lines.map(line => line.text + endings[line.terminator]).join(''), 'utf8');
}

/** Recompute and validate the ENTIRE canonical plan before using a selection.
 * selectedIds must be an array of unique known unit IDs (order is irrelevant).
 * None returns an exact fresh copy of before; all an exact fresh copy of after.
 * Subsets splice only canonical target blocks into the original raw bytes;
 * replacements are atomic. No caller-supplied offsets or content are trusted.
 * Throws AbortError on cancellation, TypeError on invalid plans/selections.
 */
export function applyPartialIndexSelection(beforeBuffer, afterBuffer, plan, selectedIds, {signal} = {}) {
  const before = snapshot(beforeBuffer, 'before'), after = snapshot(afterBuffer, 'after');
  const canonical = buildPlan(before, after, signal);
  if (!canonicalEqual(plan, canonical, signal)) throw new TypeError('Invalid or stale partial index plan');
  if (!Array.isArray(selectedIds)) throw new TypeError('Selection must be an array of unit IDs');
  const known = new Set(canonical.units.map(unit => unit.id)), selected = new Set();
  for (const id of selectedIds) {
    checkAbort(signal);
    if (typeof id !== 'string' || !known.has(id) || selected.has(id)) throw new TypeError('Unknown or duplicate unit ID');
    selected.add(id);
  }
  checkAbort(signal);
  if (!selected.size) return Buffer.from(before);
  if (selected.size === canonical.units.length) return Buffer.from(after);
  const original = tokenize(before, signal), chunks = [];
  let cursor = 0;
  for (const unit of canonical.units) {
    checkAbort(signal);
    if (!selected.has(unit.id)) continue;
    chunks.push(encode(original.slice(cursor, unit.beforeStart)), encode(unit.after));
    cursor = unit.beforeStart + unit.beforeCount;
  }
  chunks.push(encode(original.slice(cursor)));
  checkAbort(signal);
  return Buffer.concat(chunks);
}
