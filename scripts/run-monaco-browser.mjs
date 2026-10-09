import {spawn,execFileSync} from 'node:child_process';
import * as vcs from '../vcs.mjs';
import {createHandler} from '../index.mjs';
import {prepareBaselineJpeg,prepareSimpleWebp} from '../image-preview.mjs';
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
 const jpeg=await evaluate("new Promise(resolve=>{const c=document.createElement('canvas');c.width=3;c.height=2;c.getContext('2d').fillRect(0,0,3,2);c.toBlob(b=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(b);},'image/jpeg',0.8);})");
 const prepared=prepareBaselineJpeg(Buffer.from(jpeg,'base64'));if(prepared.width!==3||prepared.height!==2)throw Error('Prepared JPEG geometry');
 await evaluate("import('./history-viewer-browser.js').then(m=>m.checkPreparedJpeg("+JSON.stringify(prepared.data.toString('base64'))+"))");await writeFile('test-results/jpeg-prepared-report.json',JSON.stringify({pass:true,width:prepared.width,height:prepared.height,bytes:prepared.bytes,metadataStripped:prepared.metadataStripped}));
 const webp=await evaluate("new Promise(resolve=>{const c=document.createElement('canvas');c.width=3;c.height=2;c.getContext('2d').fillRect(0,0,3,2);c.toBlob(b=>{if(b.type!=='image/webp')throw Error('WebP unavailable');const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.readAsDataURL(b);},'image/webp',0.8);})");
 const encodedWebp=Buffer.from(webp,'base64'),webpChunks=[];for(let offset=12;offset<encodedWebp.length;){const size=encodedWebp.readUInt32LE(offset+4),end=offset+8+size+(size&1);if(end>encodedWebp.length)throw Error('Canvas WebP chunk bounds');webpChunks.push({type:encodedWebp.toString('ascii',offset,offset+4),data:encodedWebp.subarray(offset,end)});offset=end;}console.log('Canvas WebP chunks:',webpChunks.map(c=>c.type));
 const imageChunk=webpChunks.find(c=>c.type==='VP8 ');if(!imageChunk)throw Error('Canvas did not encode lossy VP8');if(webpChunks.length>1){let rejected=false;try{prepareSimpleWebp(encodedWebp);}catch{rejected=true;}if(!rejected)throw Error('Extended WebP unexpectedly accepted');}
 // Explicitly build a simple-container test fixture from the opaque lossy VP8 payload.
 // Product adapters still reject the original extended canvas output, not silently strip it.
 const simpleWebp=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(4),Buffer.from('WEBP'),imageChunk.data]);simpleWebp.writeUInt32LE(simpleWebp.length-8,4);
 const preparedWebp=prepareSimpleWebp(simpleWebp);if(preparedWebp.width!==3||preparedWebp.height!==2)throw Error('Prepared WebP geometry');await evaluate("import('./history-viewer-browser.js').then(m=>m.checkPreparedWebp("+JSON.stringify(preparedWebp.data.toString('base64'))+"))");await writeFile('test-results/webp-prepared-report.json',JSON.stringify({pass:true,bytes:preparedWebp.bytes,width:preparedWebp.width,height:preparedWebp.height}));
 const repository=await mkdtemp(path.join(os.tmpdir(),'vcs-jpeg-repo-'));
 try{
  const git=(...args)=>execFileSync('git',['-C',repository,...args],{encoding:'utf8'});git('init','-q');git('config','user.name','JPEG');git('config','user.email','jpeg@example.test');git('config','core.autocrlf','false');await writeFile(path.join(repository,'image.jpg'),Buffer.from(jpeg,'base64'));git('add','.');git('commit','-qm','image');const commit=git('rev-parse','HEAD').trim();await writeFile(path.join(repository,'image.jpg'),'UNCOMMITTED');
  const rpc=createHandler({sessions:{get:()=>({header:{cwd:repository}})},sessionPersistence:{stat:async()=>undefined}},vcs);const discovery=await rpc('vcs/repositories',{sessionId:'jpeg'});if(!discovery.ok)throw Error('JPEG discovery failed');const repositoryId=discovery.value.repositories[0].id;const details=await rpc('vcs/commit',{sessionId:'jpeg',repositoryId,commit});if(!details.ok)throw Error('JPEG details failed');const id=details.value.changes[0].id;
  const result=await rpc('vcs/commit-image',{sessionId:'jpeg',repositoryId,commit,id});if(!result.ok||result.value.mime!=='image/jpeg'||result.value.width!==3)throw Error('JPEG authorized committed image failed');await evaluate("import('./history-viewer-browser.js').then(m=>m.checkPreparedJpeg("+JSON.stringify(result.value.base64)+"))");
  const pair=await rpc('vcs/revision-image',{sessionId:'jpeg',repositoryId,base:commit,target:commit,id});if(pair.ok)throw Error('Unrelated JPEG pair id accepted');
  await writeFile(path.join(repository,'image.jpg'),Buffer.from(jpeg,'base64'));git('mv','image.jpg','renamed.jpg');git('commit','-qm','rename');const target=git('rev-parse','HEAD').trim();const entries=await rpc('vcs/revision-changes',{sessionId:'jpeg',repositoryId,base:commit,target});if(!entries.ok)throw Error('JPEG pair details failed');const pairId=entries.value.changes[0].id,images=[];
  for(const side of ['left','right']){const image=await rpc('vcs/revision-image',{sessionId:'jpeg',repositoryId,base:commit,target,id:pairId,side});if(!image.ok||image.value.mime!=='image/jpeg'||image.value.path!==(side==='left'?'image.jpg':'renamed.jpg'))throw Error('JPEG pair rename paths');images.push(image.value);}
  await writeFile(path.join(repository,'renamed.jpg'),'invalid staged bytes');git('add','.');await writeFile(path.join(repository,'renamed.jpg'),Buffer.from(jpeg,'base64'));
  for(const mode of ['all','staged','unstaged']){const status=await rpc('vcs/status',{sessionId:'jpeg',repositoryId,mode});if(!status.ok)throw Error('JPEG workspace status');const selection={sessionId:'jpeg',repositoryId,mode,id:status.value.changes[0].id};for(const side of ['left','right']){const image=await rpc('vcs/workspace-image',{...selection,side});const invalid=(mode==='staged'&&side==='right')||(mode==='unstaged'&&side==='left');if(invalid?image.ok:!image.ok||image.value.mime!=='image/jpeg')throw Error('JPEG workspace mode incorrect');}}
  await evaluate("import('./history-viewer-browser.js').then(m=>m.checkJpegComparison("+JSON.stringify(images)+"))");
  await writeFile('test-results/jpeg-repository-report.json',JSON.stringify({pass:true,commit,bytes:result.value.bytes,metadataStripped:result.value.metadataStripped,scope:'real Git Session RPC committed bytes ignoring working changes'}));
 }finally{await rm(repository,{recursive:true,force:true});}
 const press=async(key,code,virtualKey,text,modifiers=0)=>{
  await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,windowsVirtualKeyCode:virtualKey,...(text?{text}: {})});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers,windowsVirtualKeyCode:virtualKey});
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
  await press('Tab','Tab',9,undefined,8);
  if(!await evaluate("document.activeElement===document.querySelectorAll('#native-graph ol button')[1]"))throw Error('Native reverse Tab entry failed');
  await press('Home','Home',36);await press('Tab','Tab',9,undefined,8);
  if(!await evaluate("document.activeElement===document.querySelector('#native-graph button')"))throw Error('Native reverse Tab exit failed');
  await press('Enter','Enter',13,'\r');
  if(!await evaluate("!document.querySelector('#native-graph svg') && document.activeElement===document.querySelector('#native-graph button') && nativeGraphState.activations===2"))throw Error('Native keyboard collapse failed');
  await writeFile('test-results/graph-native-report.json',JSON.stringify({pass:true,state:await evaluate('nativeGraphState'),steps:['arrow-focus','enter-activation','space-activation','tab-exit','reverse-tab-entry','reverse-tab-exit','keyboard-collapse']}));
 }finally{await evaluate('disposeNativeGraph();delete globalThis.disposeNativeGraph');}
 await evaluate("import('./blame-native-browser.js').then(async m=>{globalThis.disposeNativeBlame=await m.mount();})");
 try{
  await press('Enter','Enter',13,'\r');await press(' ','Space',32,' ');
  if(!await evaluate("nativeBlameState.selected.length===2 && nativeBlameState.selected.every(id=>id==='a'.repeat(40)) && nativeBlameState.trusted.length===2 && nativeBlameState.trusted.every(Boolean) && nativeBlameState.calls===1"))throw Error('Native blame activation failed');
  await press('Tab','Tab',9);if(!await evaluate("document.activeElement.id==='after-blame'"))throw Error('Native blame Tab exit failed');
  await press('Tab','Tab',9,undefined,8);if(!await evaluate("document.activeElement===document.querySelector('#native-blame tbody button')"))throw Error('Native blame reverse Tab failed');
  await writeFile('test-results/blame-native-report.json',JSON.stringify({pass:true,state:await evaluate('nativeBlameState')}));
 }finally{await evaluate('disposeNativeBlame();delete globalThis.disposeNativeBlame');}
}finally{ws?.close();chrome.kill();await new Promise(r=>chrome.exitCode!==null?r():chrome.once('exit',r));await rm(profile,{recursive:true,force:true,maxRetries:5});}
