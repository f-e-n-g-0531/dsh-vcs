import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {operationLayoutCases, operationLayoutStates} from '../scripts/operation-layout-cases.mjs';

test('operation layout matrix covers both locales, three widths, short height and current all-mode status cases', () => {
  assert.equal(operationLayoutCases.length,36);
  assert.equal(new Set(operationLayoutCases.map(value=>JSON.stringify(value))).size,36);
  for (const language of ['zh','en']) for (const width of [1100,600,320]) for (const height of [720,480]) for (const status of ['empty','modified','status-error']) {
    assert.ok(operationLayoutCases.some(value=>value.language===language&&value.width===width&&value.height===height&&value.status===status));
  }
  assert.deepEqual(operationLayoutStates,['short-reference','long-reference','scan-warning']);
});

test('real production page and raw stylesheet bundle without generating a fake DOM fixture', async () => {
  const result = await build({entryPoints:[fileURLToPath(new URL('../scripts/operation-layout-browser.jsx',import.meta.url))],bundle:true,write:false,format:'esm',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'}});
  assert.equal(result.errors.length,0);
  assert.equal(result.outputFiles.length,1);
  const source = result.outputFiles[0].text;
  assert.ok(source.includes('function createPage('));
  assert.ok(source.includes('vcs-operations'));
  assert.ok(source.includes('Production stylesheet is not active'));
});
