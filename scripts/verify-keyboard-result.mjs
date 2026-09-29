import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const html=await readFile(new URL('../test-results/keyboard-dom.html',import.meta.url),'utf8');
const text=html.split('<pre>')[1]?.split('</pre>')[0];
assert.ok(text,'No browser report');
const report=JSON.parse(text.replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&'));
await writeFile(new URL('../test-results/keyboard-result.json',import.meta.url),JSON.stringify(report,null,2));
const names=new Set(['outside','panel-find','panel-mac-find','previous','next','search-clear','search-find','search-no-navigation','input','editable','monaco','composition','handled']);
assert.equal(report.results.length,names.size);
assert.ok(report.browser);
for(const row of report.results){assert.ok(names.delete(row.name));assert.equal(row.pass,true,JSON.stringify(row));assert.equal(row.action,row.expected);}
assert.equal(names.size,0);
console.log('PASS: 13 synthetic DOM keyboard cases; '+report.browser);
