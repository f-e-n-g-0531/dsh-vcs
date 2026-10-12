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
  assert.equal(decodeLargeText(Buffer.from('\n'.repeat(99999))).lineCount, 100000);
  const exact=Buffer.from(('x'.repeat(1023)+'\n').repeat(8192));
  assert.equal(exact.length, MAX_LARGE_TEXT);
  assert.equal(decodeLargeText(exact).totalBytes, MAX_LARGE_TEXT);
  assert.equal(decodeLargeText(Buffer.from('中文文本\n')).encoding, 'UTF-8');
  const controller = new AbortController(); controller.abort();
  assert.throws(() => decodeLargeText(Buffer.from('safe'), controller.signal), {name: 'AbortError'});
});
test('large text decodes GBK and BOM UTF-16 without relaxing budgets',()=>{
 const le=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from('行\n同\r\n','utf16le')]);
 assert.equal(decodeLargeText(le).encoding,'UTF-16LE');assert.equal(decodeLargeText(le).text,'行\n同\r\n');assert.equal(decodeLargeText(le).lineCount,3);
 const beUnit=Buffer.from('行\n','utf16le');for(let i=0;i<beUnit.length;i+=2){const t=beUnit[i];beUnit[i]=beUnit[i+1];beUnit[i+1]=t;}
 assert.equal(decodeLargeText(Buffer.concat([Buffer.from([0xfe,0xff]),beUnit])).encoding,'UTF-16BE');
 const gb=Buffer.from([0xd6,0xd0,0xce,0xc4,0x0a]);const gr=decodeLargeText(gb);assert.equal(gr.encoding,'GBK');assert.equal(gr.text,'中文\n');
 assert.throws(()=>decodeLargeText(Buffer.from([0xff,0xfe,0x41])),/UTF-16/);
});
