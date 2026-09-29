import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {comparisonLabels} from '../src/comparison-labels.mjs';
test('all text comparison labels exist in both languages',async()=>{
 const locales=JSON.parse(await readFile(new URL('../src/locales.json',import.meta.url),'utf8'));
 for(const language of ['zh','en']){
  const labels=comparisonLabels(key=>locales[language][key]);
  assert.deepEqual(Object.keys(labels),['before','after','readonly','empty','approximate','truncated']);
  for(const text of Object.values(labels))assert.ok(typeof text==='string'&&text.length>0);
 }
 assert.equal(comparisonLabels(key=>locales.zh[key]).empty,'两个版本均为空。');
});
