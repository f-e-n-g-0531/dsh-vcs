import test from 'node:test';
import assert from 'node:assert/strict';
import {loadEditor} from '../src/editor-loader.mjs';
test('resource failures are actionable and never imported',async()=>{
 for(const status of [401,404,503])await assert.rejects(loadEditor('https://test/editor.js',{fetcher:async()=>new Response('error',{status}),importer:()=>assert.fail('must not import')}),new RegExp('HTTP '+status));
 await assert.rejects(loadEditor('https://test/editor.js',{fetcher:async()=>new Response('<html>',{headers:{'content-type':'text/html'}})}),/instead of JavaScript/);
});
test('same-origin fetch and exact module URL preserve worker base',async()=>{
 const url='https://test/editor.js?v=3';const expected={createDiff(){}};
 assert.equal(await loadEditor(url,{fetcher:async(u,o)=>{assert.equal(u,url);assert.equal(o.credentials,'same-origin');return new Response('export {}',{headers:{'content-type':'text/javascript'}});},importer:async u=>{assert.equal(u,url);return expected;}}),expected);
});
