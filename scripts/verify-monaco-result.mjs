import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const html=await readFile('test-results/monaco-dom.html','utf8');
const text=html.split('<pre id="report">')[1]?.split('</pre>')[0];
assert.ok(text,'Missing Monaco report');
const report=JSON.parse(text.replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&'));
assert.equal(report.pass,true,JSON.stringify(report));assert.ok(report.browser);
assert.deepEqual(report.steps,['two-modules','two-diffs','survivor-update','dispose','react-controls','revision-controls','file-history','blame','tree','graph','image']);assert.deepEqual(report.cases,['same-0','same-1','retry-0','retry-1']);console.log(report);
