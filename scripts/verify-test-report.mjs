import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export function verifyTestReport(tap) {
  assert.equal(typeof tap,'string');assert.match(tap,/^TAP version 13$/m,'Missing TAP header');
  assert.ok(!/^Bail out!/m.test(tap),'Test run bailed out');
  const summary={};
  for(const key of ['tests','pass','fail','cancelled','skipped','todo']) {
    const rows=[...tap.matchAll(new RegExp('^# '+key+' ([0-9]+)$','gm'))];
    assert.equal(rows.length,1,'Missing or ambiguous TAP summary: '+key);summary[key]=Number(rows[0][1]);
  }
  assert.ok(Number.isSafeInteger(summary.tests)&&summary.tests>0,'Empty test suite');
  assert.equal(summary.pass,summary.tests,'Incomplete test run');
  for(const key of ['fail','cancelled','skipped','todo'])assert.equal(summary[key],0,'Release policy requires zero '+key);
  assert.ok(!/^not ok /m.test(tap),'Failed TAP result');return summary;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(verifyTestReport(await readFile(process.argv[2],'utf8')),null,2));
