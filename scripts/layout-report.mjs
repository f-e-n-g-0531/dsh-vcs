import assert from 'node:assert/strict';
export function validateLayoutReport(report) {
  assert.ok(report && typeof report.browser==='string' && report.browser.trim(),'Missing browser identity');
  assert.ok(Array.isArray(report.results),'Missing results array');
  const expected=new Set();
  for(const lang of ['zh','en'])for(const width of [180,260])for(const zoom of [1,1.25,2])expected.add(lang+' / '+width+'px / CSS zoom '+zoom);
  assert.equal(report.results.length,expected.size,'Wrong case count');
  for(const row of report.results){
    assert.ok(row && expected.delete(row.case),'Unknown or duplicate case');
    assert.equal(row.pass,true,JSON.stringify(row));
    assert.equal(row.inside,true,'Buttons outside filter');
    assert.equal(row.overlap,false,'Buttons overlap');
    assert.equal(row.renameHit,true,'Rename is obscured');
  }
  assert.equal(expected.size,0,'Missing cases');
  return report;
}
