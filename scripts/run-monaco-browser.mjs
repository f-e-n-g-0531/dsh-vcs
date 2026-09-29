import {spawn} from 'node:child_process';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const profile=await mkdtemp(path.join(os.tmpdir(),'vcs-chrome-'));
const chrome=spawn('google-chrome',['--headless','--no-sandbox','--disable-gpu','--remote-debugging-port=9229','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
let ws;const pending=new Map();let seq=0;
const pause=()=>new Promise(r=>setTimeout(r,100));
try{
 let tabs;for(let i=0;i<100;i++){try{tabs=await (await fetch('http://127.0.0.1:9229/json')).json();break;}catch{await pause();}}
 if(!tabs)throw Error('Chrome debugging unavailable');
 ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}};
 const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/test-results/monaco-fixture.html'});
 const deadline=Date.now()+30000;let report;
 while(Date.now()<deadline){const r=await call('Runtime.evaluate',{expression:'document.querySelector("#report")?.textContent',returnByValue:true});report=r.result.value;if(report&&report!=='pending')break;await pause();}
 const dom=await call('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true});await writeFile('test-results/monaco-dom.html',dom.result.value);
 if(!report||report==='pending')throw Error('Monaco report not completed within 30 seconds');
 console.log(report);
}finally{ws?.close();chrome.kill();await new Promise(r=>chrome.exitCode!==null?r():chrome.once('exit',r));await rm(profile,{recursive:true,force:true,maxRetries:5});}
