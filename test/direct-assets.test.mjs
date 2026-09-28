import test from 'node:test';
import assert from 'node:assert/strict';
import {registerDirectAssets} from '../index.mjs';
test('dedicated assets authenticate all requests and register exact disposable paths',async()=>{
 const routes=[],disposers=[];let denied,reads=0;
 registerDirectAssets({effect:fn=>disposers.push(fn()),webServer:{register:r=>{routes.push(r);return()=>{};}},connection:{admit:()=>denied?{rejection:denied}:{peer:{}}}},async()=>{reads++;return Buffer.from('export {}');});
 assert.equal(routes.length,3);assert.equal(disposers.length,3);assert.ok(routes.every(r=>r.kind==='exact'&&r.path.startsWith('/vcs-assets/')));
 const run=async method=>{const result={};await routes[0].handler({method,url:'/vcs-assets/editor.js?v=0.3.1&retry=1'},{writeHead:(status,headers)=>Object.assign(result,{status,headers}),end:body=>{result.body=body;}});return result;};
 for(const status of [401,403]){denied=status;assert.equal((await run('GET')).status,status);}assert.equal(reads,0);denied=undefined;
 assert.equal((await run('POST')).status,405);assert.equal(reads,0);
 const get=await run('GET');assert.equal(get.status,200);assert.equal(get.body.toString(),'export {}');assert.match(get.headers['Content-Type'],/javascript/);
 const head=await run('HEAD');assert.equal(head.status,200);assert.equal(head.body,undefined);
});
