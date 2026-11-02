import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {opensslCommand,chromeCommand} from '../scripts/test-tools.mjs';
import {probeTools} from '../scripts/test-preflight.mjs';
test('preflight reports explicit configured tools without shell or installation',()=>{const calls=[];const result=probeTools({browser:true,env:{DSH_TEST_GIT:'ignored',DSH_TEST_SVN:'ignored',OPENSSL_BIN:'custom ssl',CHROME_BIN:'custom chrome'},run:(command,args,options)=>{calls.push([command,args,options]);return {status:0,stdout:'version 1'};}});assert.equal(result.chrome,'version 1');assert.ok(calls.some(c=>c[0]==='custom ssl'));assert.equal(calls[0][0],'git');assert.equal(calls[1][0],'svn');assert.ok(calls.some(c=>c[0]==='custom chrome'));assert.ok(calls.every(c=>c[2].shell===false));});
test('missing failing or empty tools fail fast with actionable tool identity',()=>{for(const result of [{error:{code:'ENOENT'}},{status:1},{status:0,stdout:''}])assert.throws(()=>probeTools({env:{},run:()=>result}),/Tool preflight: git/);});
test('TLS fixtures and browser launchers share the same configured command as preflight',async()=>{
 assert.equal(opensslCommand({OPENSSL_BIN:'configured ssl'}),'configured ssl');assert.equal(chromeCommand({CHROME_BIN:'configured chrome'}),'configured chrome');
 for(const file of ['test/bounded-https-tls.test.mjs','test/svn-dav-chain-tls.test.mjs','scripts/svn-dav-fixture.mjs'])assert.ok((await readFile(new URL('../'+file,import.meta.url),'utf8')).includes('opensslCommand()'));
 for(const file of ['scripts/run-svn-live-browser.mjs','scripts/run-monaco-browser.mjs'])assert.ok((await readFile(new URL('../'+file,import.meta.url),'utf8')).includes('startBrowser(chromeCommand()'));
 const layout=await readFile(new URL('../.github/workflows/layout.yml',import.meta.url),'utf8');assert.ok(!layout.includes('google-chrome --'));assert.ok(layout.includes('"$CHROME_BIN" --'));
});
