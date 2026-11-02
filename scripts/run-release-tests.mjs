import {spawnSync} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {verifyTestReport} from './verify-test-report.mjs';
import {probeTools} from './test-preflight.mjs';
await mkdir('test-results',{recursive:true});
const tools=probeTools();await writeFile('test-results/tools.json',JSON.stringify(tools,null,2));
const fd=openSync('test-results/release.tap','w');let result;
try{const files=(await readdir('test')).filter(n=>n.endsWith('.test.mjs')).sort().map(n=>'test/'+n);result=spawnSync(process.execPath,['--test','--test-reporter=tap',...files],{stdio:['ignore',fd,'inherit'],windowsHide:true});}finally{closeSync(fd);}
if(result.error)throw result.error;
const summary=verifyTestReport(await readFile('test-results/release.tap','utf8'));
await writeFile('test-results/test-summary.json',JSON.stringify(summary,null,2));
console.log(summary);if(result.status!==0)throw Error('Test process failed: '+result.status);
