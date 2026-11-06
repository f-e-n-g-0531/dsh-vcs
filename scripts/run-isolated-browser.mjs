// Generated React/Monaco fixtures only. Never installs into or replaces DSH.
import {writeFile} from 'node:fs/promises';
import {startBrowser,startFixtureServer} from './browser-runner.mjs';
const executable=process.env.CHROME_BIN;
if(!executable)throw Error('Set CHROME_BIN to an existing Chrome/Chromium executable. No browser is installed automatically.');
let browser,server;
try {
 server=await startFixtureServer();
 const url=server.origin+'/test-results/monaco-fixture.html';
 console.log('Isolated fixture URL (not the running DSH GUI):',url);
 browser=await startBrowser(executable,{timeoutMs:210000});
 await browser.navigate(url);
 const deadline=Date.now()+180000;let report;
 while(Date.now()<deadline){
  const response=await browser.call('Runtime.evaluate',{expression:'document.querySelector("#report")?.textContent',returnByValue:true});
  const text=response.result.value;
  if(text&&text!=='pending'){report=JSON.parse(text);break;}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 if(!report)throw Error('Isolated fixture did not complete within 180 seconds.');
 await writeFile('test-results/isolated-browser-report.json',JSON.stringify({...report,scope:'isolated React/Monaco fixture, not live DSH or external SVN'},null,2)+String.fromCharCode(10));
 if(!report.pass){
  const dom=await browser.call('Runtime.evaluate',{expression:'document.documentElement.outerHTML',returnByValue:true});
  await writeFile('test-results/isolated-browser-failure.html',dom.result.value);
  throw Error(JSON.stringify(report));
 }
 const evaluate=async expression=>{const r=await browser.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await evaluate("import('./image-native-browser.js').then(async m=>{globalThis.disposeNativeImage=await m.mount();})");
 try{for(const mode of ['overlay','swipe']){await evaluate('nativeImage.focus('+JSON.stringify(mode)+')');for(const [key,vk,expected]of [['Home',36,'0'],['ArrowRight',39,'1'],['End',35,'100'],['ArrowLeft',37,'99']]){for(const type of ['keyDown','keyUp'])await browser.call('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:vk});const state=await evaluate('nativeImage.state()');if(state.value!==expected||state.calls!==2||!state.trusted.length||!state.trusted.every(Boolean))throw Error('Native image range '+mode+' '+key+' '+JSON.stringify(state));}}await writeFile('test-results/image-native-report.json',JSON.stringify({pass:true,state:await evaluate('nativeImage.state()'),scope:'trusted CDP key events, isolated fixture'}));}finally{await evaluate('disposeNativeImage();delete globalThis.disposeNativeImage');}
 console.log(JSON.stringify(report));
}finally{try{await browser?.close();}finally{await server?.close();}}
