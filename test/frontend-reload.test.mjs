import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateFrontend,loadFrontend} from '../src/frontend-loader.mjs';
import {registerFrontendAssets} from '../frontend-assets.mjs';
const manifest={protocol:1,version:'0.3.104',backend:'a'.repeat(64),runningBackend:'a'.repeat(64),interface:'b'.repeat(64)};
test('frontend manifest fails closed on malformed or changed backend',()=>{
 assert.equal(validateFrontend(manifest),manifest);
 for(const patch of [{protocol:2},{version:'latest'},{interface:'../x'},{backend:'other'}])assert.throws(()=>validateFrontend({...manifest,...patch}));
 assert.throws(()=>validateFrontend({...manifest,backend:'c'.repeat(64)}),e=>e.code==='restart-required');
});
test('frontend loader authenticates same-origin fixed resources and imports only compatible manifest',async()=>{
 let imported=0;
 const options={base:'https://local.test/ui/',requireModule:()=>{},fetcher:async(url,init)=>{assert.equal(url.href,'https://local.test/ui/vcs-assets/frontend.json');assert.equal(init.credentials,'same-origin');assert.equal(init.redirect,'error');return Response.json(manifest);},importer:async url=>{imported++;assert.equal(url,'https://local.test/ui/vcs-assets/interface.js?hash='+manifest.interface);return {default:()=>({createPage(){},dictionaries:{}})};}};
 await loadFrontend(options);assert.equal(imported,1);
 await assert.rejects(loadFrontend({...options,fetcher:async()=>Response.json({...manifest,backend:'c'.repeat(64)})}),e=>e.code==='restart-required');assert.equal(imported,1);
 for(const response of [new Response('denied',{status:401}),new Response('<html>')])await assert.rejects(loadFrontend({...options,fetcher:async()=>response}));assert.equal(imported,1);
 const c=new AbortController();c.abort();await assert.rejects(loadFrontend({...options,signal:c.signal}));assert.equal(imported,1);
});
test('frontend routes enforce admission methods hash binding and current disk manifest',async()=>{
 const routes=[],bytes=Buffer.from('export default function(){}');let deny=401,reads=0;
 registerFrontendAssets({effect:fn=>fn(),connection:{admit:()=>deny?{rejection:deny}:{}},webServer:{register:r=>{routes.push(r);return()=>{};}}},{running:manifest,load:async name=>{reads++;return name==='interface.js'?bytes:Buffer.from(JSON.stringify(manifest));}});
 const run=async(index,url,method='GET')=>{const r={};await routes[index].handler({url,method},{writeHead:(status,headers)=>Object.assign(r,{status,headers}),end:body=>r.body=body});return r;};
 assert.equal((await run(0,'/vcs-assets/frontend.json')).status,401);assert.equal(reads,0);deny=0;
 assert.equal((await run(0,'/vcs-assets/frontend.json','POST')).status,405);assert.equal(reads,0);
 const data=await run(0,'/vcs-assets/frontend.json');assert.equal(JSON.parse(data.body).runningBackend,manifest.backend);assert.equal(data.headers['Cache-Control'],'private, no-store');
 assert.equal((await run(1,'/vcs-assets/interface.js?hash=wrong')).status,409);
 const url='/vcs-assets/interface.js?hash='+createHash('sha256').update(bytes).digest('hex');assert.ok((await run(1,url)).body.equals(bytes));assert.equal((await run(1,url,'HEAD')).body,undefined);
});
