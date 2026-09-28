import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePackReport} from '../scripts/pack-report.mjs';
const report=[{filename:'test.tgz',files:[{path:'index.mjs',size:1}]}];
const nl=String.fromCharCode(10), crlf=String.fromCharCode(13,10);
for(const prefix of ['', 'Built DSH VCS client, lazy editor, stylesheet and worker.'+nl, '> prepare'+crlf+'[build] progress'+crlf])test('pack report handles prefix '+JSON.stringify(prefix),()=>assert.deepEqual(parsePackReport(prefix+JSON.stringify(report,null,2)),report));
test('reject malformed, missing, multiple or trailing corrupted reports',()=>{for(const value of ['Built DSH', '[{', '[]',JSON.stringify([...report,...report]),JSON.stringify(report)+nl+'error'])assert.throws(()=>parsePackReport(value));});
