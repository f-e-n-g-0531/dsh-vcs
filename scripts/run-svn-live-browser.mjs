import {chromeCommand} from './test-tools.mjs';
import {startBrowser, startFixtureServer} from './browser-runner.mjs';
import {writeFile,mkdir,copyFile} from 'node:fs/promises';
import {build} from 'esbuild';

export async function runSvnLiveBrowser(config) {
  await mkdir('test-results/vcs-assets',{recursive:true});
  for(const file of ['editor.js','editor.css','editor.worker.js']) await copyFile('dist/'+file,'test-results/vcs-assets/'+file);
  await build({entryPoints:['scripts/svn-live-browser.jsx'],outfile:'test-results/svn-live-browser.js',bundle:true,format:'esm',define:{'process.env.NODE_ENV':'"production"'}});
  let server,browser;
  try {
    // The CI bridge intentionally grants this exact origin; fail if occupied rather than reuse another server.
    server=await startFixtureServer({port:8765});
    browser=await startBrowser(chromeCommand(),{timeoutMs:120000,commandTimeoutMs:90000});
    await browser.navigate(server.origin+'/test-results/');
    const result=await browser.call('Runtime.evaluate',{expression:"import('./svn-live-browser.js').then(m=>m.checkLiveSvn("+JSON.stringify(config)+"))",awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    await writeFile('test-results/svn-live-browser-report.json',JSON.stringify(result.result.value));
    if(!result.result.value?.pass) throw Error('Live browser failed');
  } finally {try{await browser?.close();}finally{await server?.close();}}
}
