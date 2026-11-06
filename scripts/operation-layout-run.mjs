// Focused CI entry: CHROME_BIN=<existing chromium> node scripts/operation-layout-run.mjs
// Uses an ephemeral profile/server; never touches the installed DSH GUI or a repo.
import {build} from 'esbuild';
import {mkdir, writeFile, copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {startBrowser, startFixtureServer} from './browser-runner.mjs';
import {operationLayoutCases} from './operation-layout-cases.mjs';
const executable = process.env.CHROME_BIN;
if (!executable) throw Error('Set CHROME_BIN to an existing Chrome/Chromium executable; no browser is installed automatically.');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = new URL('../test-results/', import.meta.url);
await mkdir(new URL('vcs-assets/',output), {recursive:true});
// Reuse already-built Monaco assets; deliberately do not invoke the full build/test suite.
for (const file of ['editor.js','editor.css','editor.worker.js']) await copyFile(new URL('../dist/'+file,import.meta.url),new URL('vcs-assets/'+file,output));
await build({absWorkingDir:root,entryPoints:['scripts/operation-layout-browser.jsx'],outfile:'test-results/operation-layout-browser.js',bundle:true,format:'esm',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'}});
// Fresh filename, not the invalid hand-built operation-layout.html fixture.
await writeFile(new URL('operation-layout-production.html',output), '<!doctype html><meta charset="utf-8"><title>Production operation layout regression</title><style>html,body{margin:0;width:100%;height:100%;--dsw-font-family:Arial,sans-serif;--dsw-alias-bg-base:white;--dsw-alias-label-primary:#222;--dsw-alias-border-l2:#aaa}</style>');
let browser, server;
const results = [], report = {pass:false,scope:'isolated production createPage + source CSS + Monaco; mocked RPC; not live DSH or Git mutation',results};
try {
  server = await startFixtureServer({root});
  browser = await startBrowser(executable,{timeoutMs:240000});
  await browser.navigate(server.origin+'/test-results/operation-layout-production.html');
  for (const config of operationLayoutCases) {
    await browser.call('Emulation.setDeviceMetricsOverride',{width:config.width,height:config.height,deviceScaleFactor:1,mobile:false});
    const response = await browser.call('Runtime.evaluate',{expression:"import('./operation-layout-browser.js').then(m=>m.checkOperationLayout("+JSON.stringify(config)+"))",returnByValue:true,awaitPromise:true});
    const result = response.exceptionDetails ? {...config,pass:false,error:response.exceptionDetails} : response.result.value;
    results.push(result);
    if (!result.pass) console.error('FAIL',JSON.stringify(result));
  }
  report.pass = results.length === operationLayoutCases.length && results.every(result=>result.pass);
  report.browser = (await browser.call('Browser.getVersion')).product;
  console.log(JSON.stringify({pass:report.pass,cases:results.length,samples:results.reduce((n,r)=>n+(r.samples?.length||0),0),failed:results.filter(r=>!r.pass).length,browser:report.browser}));
  if (!report.pass) process.exitCode = 1;
} catch (error) {report.error = error.stack;throw error;}
finally {
  try {await writeFile(new URL('operation-layout-report.json',output),JSON.stringify(report,null,2)+String.fromCharCode(10));}
  finally {try {await browser?.close();} finally {await server?.close();}}
}
