import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyTestReport} from '../scripts/verify-test-report.mjs';
const report=(patch={})=>['TAP version 13','ok 1 - authorized path','ok 2 - cancellation',...Object.entries({tests:2,pass:2,fail:0,cancelled:0,skipped:0,todo:0,...patch}).map(([k,v])=>'# '+k+' '+v)].join(String.fromCharCode(10));
test('release report accepts complete nonempty zero skip TAP',()=>assert.equal(verifyTestReport(report()).tests,2));
test('release report refuses skips failure cancellation todo empty incomplete and ambiguous summaries',()=>{for(const patch of [{skipped:1},{todo:1},{fail:1},{cancelled:1},{tests:0,pass:0},{pass:1}])assert.throws(()=>verifyTestReport(report(patch)));assert.throws(()=>verifyTestReport('TAP version 13'));assert.throws(()=>verifyTestReport(report()+String.fromCharCode(10)+'# tests 2'));assert.throws(()=>verifyTestReport(report()+String.fromCharCode(10)+'Bail out!'));});
