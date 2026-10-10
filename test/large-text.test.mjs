import test from 'node:test';
import assert from 'node:assert/strict';
import {decode, decodeLargeText, MAX_LARGE_TEXT} from '../text-content.mjs';

test('large text is complete while ordinary previews retain 2 MiB limit', () => {
  const text = ('中文'+ 'x'.repeat(90)+'\n').repeat(24000);
  const bytes = Buffer.from(text);
  assert.ok(bytes.length > 2 * 1024 * 1024);
  assert.equal(decode(bytes).text, '');
  const result = decodeLargeText(bytes);
  assert.equal(result.text, text);
  assert.equal(result.totalBytes, bytes.length);
  assert.equal(result.lineCount, 24001);
});

test('large text refuses oversized binary invalid encoding and pathological lines', () => {
  assert.throws(() => decodeLargeText(Buffer.alloc(MAX_LARGE_TEXT + 1)), /8 MiB/);
  assert.throws(() => decodeLargeText(Buffer.from([0])), /control/);
  assert.throws(() => decodeLargeText(Buffer.from([0xff])), /UTF-8/);
  assert.throws(() => decodeLargeText(Buffer.from('x'.repeat(65537))), /characters per line/);
  assert.throws(() => decodeLargeText(Buffer.from('\n'.repeat(100000))), /100000 lines/);
  assert.throws(() => decodeLargeText(Buffer.from('\r'.repeat(100000))), /100000 lines/);
  assert.equal(decodeLargeText(Buffer.from('a\r\nb\rc\n')).lineCount, 4);
  assert.equal(decodeLargeText(Buffer.from('x'.repeat(65536))).text.length, 65536);
  const controller = new AbortController(); controller.abort();
  assert.throws(() => decodeLargeText(Buffer.from('safe'), controller.signal), {name: 'AbortError'});
});
