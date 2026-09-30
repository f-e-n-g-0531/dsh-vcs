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
 if(!JSON.parse(report).pass)throw Error('Main browser fixture failed');
 const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
 await evaluate("import('./graph-native-browser.js').then(m=>{globalThis.disposeNativeGraph=m.mount();})");
 const press=async(key,code,virtualKey,text)=>{
  await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtualKey,...(text?{text}: {})});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtualKey});
 };
 try{
  await press('ArrowDown','ArrowDown',40);
  if(!await evaluate("document.activeElement===document.querySelectorAll('#native-graph ol button')[1] && nativeGraphState.activations===0"))throw Error('Native arrow focus failed');
  await press('Enter','Enter',13,'\r');
  if(!await evaluate("nativeGraphState.activations===1 && nativeGraphState.selected==='2'.padStart(40,'0')"))throw Error('Native Enter activation failed');
  await press('Home','Home',36);
  await press(' ','Space',32,' ');
  if(!await evaluate("nativeGraphState.activations===2 && nativeGraphState.selected==='1'.padStart(40,'0') && nativeGraphState.trusted.every(Boolean)"))throw Error('Native Space activation failed');
  await press('End','End',35);await press('Tab','Tab',9);
  if(!await evaluate("document.activeElement===document.querySelector('#native-graph summary') && nativeGraphState.activations===2"))throw Error('Native Tab exit failed');
  await writeFile('test-results/graph-native-report.json',JSON.stringify({pass:true,state:await evaluate('nativeGraphState'),steps:['arrow-focus','enter-activation','space-activation','tab-exit']}));
 }finally{await evaluate('disposeNativeGraph();delete globalThis.disposeNativeGraph');}
}finally{ws?.close();chrome.kill();await new Promise(r=>chrome.exitCode!==null?r():chrome.once('exit',r));await rm(profile,{recursive:true,force:true,maxRetries:5});}
