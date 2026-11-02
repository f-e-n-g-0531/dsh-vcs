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
 console.log(JSON.stringify(report));
}finally{try{await browser?.close();}finally{await server?.close();}}
