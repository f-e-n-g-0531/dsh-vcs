import {build} from 'esbuild';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
const browser=process.argv[2];
if(!browser)throw Error('Pass a Chromium executable path');
await build({stdin:{contents:"import {checkHistoryLayout} from './scripts/history-layout-browser.jsx'; import {checkSvnHistory} from './scripts/svn-history-browser.jsx'; import {checkFrontendReload} from './scripts/frontend-reload-browser.jsx'; (async()=>{try{await checkHistoryLayout();await checkSvnHistory();await checkFrontendReload();document.querySelector('#report').textContent='PASS';}catch(e){document.querySelector('#report').textContent=e.stack;}})();",resolveDir:process.cwd(),loader:'jsx'},outfile:'test-results/history-layout-local.js',bundle:true,format:'iife',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'}});
await writeFile('test-results/history-layout-local.html','<!doctype html><meta charset="utf-8"><base href="'+pathToFileURL(path.resolve('test-results')+path.sep).href+'"><pre id="report">pending</pre><script src="history-layout-local.js"></script>');
const profile=await mkdtemp(path.join(os.tmpdir(),'vcs-history-layout-'));
const child=spawn(browser,['--headless','--disable-gpu','--no-first-run','--allow-file-access-from-files','--remote-debugging-port=9238','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
let ws;try{
 const deadline=Date.now()+60000;let tabs;
 while(Date.now()<deadline){try{tabs=await(await fetch('http://127.0.0.1:9238/json')).json();break;}catch{await new Promise(r=>setTimeout(r,150));}}
 if(!tabs)throw Error('Browser CDP unavailable');
 ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 await call('Page.navigate',{url:pathToFileURL(path.resolve('test-results/history-layout-local.html')).href});
 let report='pending';while(Date.now()<deadline){const r=await call('Runtime.evaluate',{expression:'document.querySelector("#report")?.textContent',returnByValue:true});report=r.result.value;if(report&&report!=='pending')break;await new Promise(r=>setTimeout(r,150));}
 console.log(report);if(report!=='PASS')throw Error('History browser regression failed');
}finally{ws?.close();child.kill();await new Promise(r=>child.once('exit',r));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
