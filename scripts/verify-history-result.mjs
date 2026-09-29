import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const html=await readFile('test-results/history-dom.html','utf8');
const text=html.split('<pre id="report">')[1]?.split('</pre>')[0];
assert.ok(text,'No report');
const report=JSON.parse(text.replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&'));
assert.equal(report.pass,true,JSON.stringify(report));assert.ok(report.browser);
assert.deepEqual(report.steps,['pagination','commit','file','diff']);assert.equal(report.calls,4);
console.log(report);
