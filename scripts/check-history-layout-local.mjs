import {build} from 'esbuild';
import {writeFile} from 'node:fs/promises';
import {startBrowser} from './browser-runner.mjs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const browser=process.argv[2];
if(!browser)throw Error('Pass a Chromium executable path');
await build({stdin:{contents:"import {checkReviewFixes} from './scripts/review-fixes-browser.jsx'; import {checkHistoryLayout} from './scripts/history-layout-browser.jsx'; import {checkSvnHistory} from './scripts/svn-history-browser.jsx'; import {checkFrontendReload} from './scripts/frontend-reload-browser.jsx'; import {checkSvnHistoryAlignment} from './scripts/svn-history-alignment-browser.jsx'; (async()=>{try{await checkReviewFixes();await checkHistoryLayout();await checkSvnHistory();await checkSvnHistoryAlignment();await checkFrontendReload();document.querySelector('#report').textContent='PASS';}catch(e){document.querySelector('#report').textContent=e.stack;}})();",resolveDir:process.cwd(),loader:'jsx'},outfile:'test-results/history-layout-local.js',bundle:true,format:'iife',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'}});
await writeFile('test-results/history-layout-local.html','<!doctype html><meta charset="utf-8"><base href="'+pathToFileURL(path.resolve('test-results')+path.sep).href+'"><pre id="report">pending</pre><script src="history-layout-local.js"></script>');
let fixture;
try {
 const deadline=Date.now()+60000;
 fixture=await startBrowser(browser,{timeoutMs:60000,args:['--allow-file-access-from-files']});
 await fixture.navigate(pathToFileURL(path.resolve('test-results/history-layout-local.html')).href);
 let report='pending';
 while(Date.now()<deadline){
  const r=await fixture.call('Runtime.evaluate',{expression:'document.querySelector("#report")?.textContent',returnByValue:true});
  report=r.result.value;if(report&&report!=='pending')break;
  await new Promise(r=>setTimeout(r,150));
 }
 console.log(report);if(report!=='PASS')throw Error('History browser regression failed');
} finally {await fixture?.close();}
