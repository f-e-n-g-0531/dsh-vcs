import {createHash} from 'node:crypto';
import {createPartialIndexPlan, MAX_PARTIAL_INDEX_BYTES} from './partial-index.mjs';

export const LINE_INDEX_ALGORITHM = 'raw-line-selection-v1';

function checkAbort(signal) {
  if (signal?.aborted) {
    const error = new Error('Line index operation aborted');
    error.name = 'AbortError';
    throw error;
  }
}

const hash = value => createHash('sha256').update(value).digest('hex');

/** Pure Buffer model, using partial-index's bounded EXACT raw-line alignment.
 * All coordinates and unitOffset values are zero-based. Operations are ordered
 * by source unit, then deletes in before order, then inserts in after order.
 * IDs bind both complete raw inputs, the complete source unit, direction, and
 * line offset. BOM and terminators are data, never normalized or synthesized.
 * Limits/UTF-8/control policy are exactly those of createPartialIndexPlan.
 * The complete plan (including source units and operations) is deeply frozen.
 */
export function createLineIndexPlan(before, after, {signal} = {}) {
  const source = createPartialIndexPlan(before, after, {signal});
  const id = hash(JSON.stringify([LINE_INDEX_ALGORITHM, source.id]));
  const operations = [];
  for (const unit of source.units) {
    for (const kind of ['delete', 'insert']) {
      const lines = kind === 'delete' ? unit.before : unit.after;
      for (let unitOffset = 0; unitOffset < lines.length; unitOffset++) {
        checkAbort(signal);
        const line = lines[unitOffset];
        const coordinate = kind === 'delete'
          ? {beforeLine: unit.beforeStart + unitOffset}
          : {afterLine: unit.afterStart + unitOffset};
        operations.push(Object.freeze({
          id: hash(JSON.stringify([id, unit.id, kind, unitOffset])),
          kind, unitId: unit.id, unitOffset, ...coordinate,
          text: line.text, terminator: line.terminator,
        }));
      }
    }
  }
  checkAbort(signal);
  return Object.freeze({...source, id, algorithm: LINE_INDEX_ALGORITHM,
    sourceAlgorithm: source.algorithm, operations: Object.freeze(operations)});
}

// Inspect own data descriptors rather than invoking supplied getters. Accept a
// plain JSON copy or null-prototype object, not extra/symbol/hidden fields,
// accessors, sparse arrays, exotic prototypes, or altered canonical values.
function canonicalEqual(supplied, expected, signal) {
  checkAbort(signal);
  if (expected === null || typeof expected !== 'object') return Object.is(supplied, expected);
  if (supplied === null || typeof supplied !== 'object' || Array.isArray(supplied) !== Array.isArray(expected)) return false;
  const prototype = Object.getPrototypeOf(supplied);
  if (Array.isArray(expected) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(expected);
  if (Reflect.ownKeys(supplied).length !== keys.length) return false;
  return keys.every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(supplied, key);
    return descriptor && Object.hasOwn(descriptor, 'value') &&
      descriptor.enumerable === Object.getOwnPropertyDescriptor(expected, key).enumerable &&
      canonicalEqual(descriptor.value, expected[key], signal);
  });
}

function selectionSet(operationIds, operations, signal) {
  if (!Array.isArray(operationIds) || Object.getPrototypeOf(operationIds) !== Array.prototype) {
    throw new TypeError('Selection must be an array of operation IDs');
  }
  const length = Object.getOwnPropertyDescriptor(operationIds, 'length').value;
  if (length > operations.length || Reflect.ownKeys(operationIds).length !== length + 1) {
    throw new TypeError('Invalid operation selection schema');
  }
  const known = new Set(operations.map(operation => operation.id)), selected = new Set();
  for (let i = 0; i < length; i++) {
    checkAbort(signal);
    const descriptor = Object.getOwnPropertyDescriptor(operationIds, String(i));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new TypeError('Invalid operation selection schema');
    }
    const id = descriptor.value;
    if (typeof id !== 'string' || !known.has(id) || selected.has(id)) {
      throw new TypeError('Unknown or duplicate operation ID');
    }
    selected.add(id);
  }
  return selected;
}

function snapshot(value, label) {
  if (!Buffer.isBuffer(value)) throw new TypeError(label + ' must be a Buffer');
  if (value.length > MAX_PARTIAL_INDEX_BYTES) throw new RangeError(label + ' exceeds 256 KiB');
  return Buffer.from(value);
}

// Validated inputs only. Byte slices preserve equal gaps without re-encoding.
function rawLines(buffer, signal) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    if ((i & 1023) === 0) checkAbort(signal);
    if (buffer[i] !== 10 && buffer[i] !== 13) continue;
    if (buffer[i] === 13 && buffer[i + 1] === 10) i++;
    lines.push(buffer.subarray(start, i + 1));
    start = i + 1;
  }
  if (start < buffer.length) lines.push(buffer.subarray(start));
  return lines;
}

/** Recompute and validate the WHOLE canonical plan before applying selection.
 * Each selected delete removes only its before token (text AND terminator).
 * Unselected before tokens remain in original order. Selected after tokens are
 * appended, in after order, AFTER those remaining before tokens in that source
 * unit's insertion slot. There is no automatic delete/insert pair coupling.
 * Equal raw gaps remain unchanged. Selection order has no effect.
 *
 * Candidate tokens must reparse to the exact selected raw-line sequence. A
 * retained unterminated token before insertion, or CR + empty LF fusion, is
 * rejected rather than silently merging lines or synthesizing delimiters.
 * Interior BOM stays literal. None returns before; all returns after, exactly.
 * Candidate bytes must still be <=256 KiB and <=4000 actual raw lines (counted
 * AFTER joins), valid UTF-8, with the same control policy as the inputs. Invalid
 * candidates throw explicitly, even when both source inputs meet the limits.
 * Candidate self-validation needs no additional LCS alignment. No I/O or RPC.
 */
export function applyLineIndexSelection(beforeBuffer, afterBuffer, plan, operationIds, {signal} = {}) {
  checkAbort(signal);
  const before = snapshot(beforeBuffer, 'before'), after = snapshot(afterBuffer, 'after');
  const canonical = createLineIndexPlan(before, after, {signal});
  if (!canonicalEqual(plan, canonical, signal)) throw new TypeError('Invalid or stale line index plan');
  const selected = selectionSet(operationIds, canonical.operations, signal);
  checkAbort(signal);
  if (!selected.size) return Buffer.from(before);
  if (selected.size === canonical.operations.length) return Buffer.from(after);
  const left = rawLines(before, signal), right = rawLines(after, signal), chunks = [];
  let cursor = 0, operationIndex = 0, bytes = 0;
  function append(chunk) {
    checkAbort(signal);
    bytes += chunk.length;
    if (bytes > MAX_PARTIAL_INDEX_BYTES) throw new RangeError('Candidate exceeds 256 KiB');
    chunks.push(chunk);
  }
  for (const unit of canonical.units) {
    while (cursor < unit.beforeStart) append(left[cursor++]);
    for (let offset = 0; offset < unit.beforeCount; offset++) {
      if (!selected.has(canonical.operations[operationIndex++].id)) append(left[cursor]);
      cursor++;
    }
    for (let offset = 0; offset < unit.afterCount; offset++) {
      if (selected.has(canonical.operations[operationIndex++].id)) append(right[unit.afterStart + offset]);
    }
  }
  while (cursor < left.length) append(left[cursor++]);
  const candidate = Buffer.concat(chunks, bytes);
  const parsed = rawLines(candidate, signal);
  if (parsed.length !== chunks.length || parsed.some((line, i) => !line.equals(chunks[i]))) {
    throw new RangeError('Selected lines would merge raw line boundaries');
  }
  // Reuse fatal UTF-8/control/actual raw-line validation, without imposing a
  // second diff-cell bound on synthetic candidates.
  createPartialIndexPlan(candidate, candidate, {signal});
  checkAbort(signal);
  return candidate;
}
