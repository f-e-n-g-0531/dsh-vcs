import assert from 'node:assert/strict';
import vm from 'node:vm';
import {Readable,Writable} from 'node:stream';
import React from 'react';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {SUPPORTED_HOSTS, validateHostManifest} from './host-compat-policy.mjs';
import {writeFile} from 'node:fs/promises';
import {verifyConsumedCandidate} from './release-evidence.mjs';
import {readFile} from 'node:fs/promises';
import * as plugin from '../index.mjs';
import {checkBranchSwitchRpc} from './branch-switch-compat.mjs';
const {resolveSessionCwd}=plugin;
// Explicit installed DSH package path; no profile boot, HTTP listener, or user credentials.
if(process.env.DSH_COMPAT_REPORT){assert.equal(process.env.GITHUB_REF_TYPE,'tag','Compatibility evidence requires a tag');assert.equal(process.env.GITHUB_REF,'refs/tags/'+process.env.RELEASE_TAG,'Compatibility evidence ref mismatch');}
const manifest=process.argv[2];
if(!manifest)throw Error('Usage: node scripts/test-host-compat.mjs <installed-dsh-package.json> [same-version-ui-slots-package.json]');
const hostManifest=JSON.parse(await readFile(path.resolve(manifest),'utf8'));
assert.equal(hostManifest.name,'@deepseek-ai/dsh');
const supportedHosts=SUPPORTED_HOSTS;
validateHostManifest(hostManifest, process.env.DSH_EXPECTED_HOST_VERSION || hostManifest.version);
const requireHost=createRequire(path.resolve(manifest));
const {evaluatePluginCompatibility}=await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-app-boot')));
const vcsManifest=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
for(const version of supportedHosts)assert.equal(evaluatePluginCompatibility(vcsManifest,{},version),undefined);
for(const version of ['0.1.7-rc.1','0.2.0-rc.1','0.2.0-rc.3','0.2.0','0.2.1-rc.1','0.2.1-rc.3','0.2.1-rc.4','0.2.1-rc.6','0.2.1','0.2.2-rc.2','0.3.0'])assert.ok(evaluatePluginCompatibility(vcsManifest,{},version));
assert.ok(evaluatePluginCompatibility({...vcsManifest,peerDependencies:{'@deepseek-ai/dsh':supportedHosts.filter(v=>v!==hostManifest.version).join(' || ')}},{},hostManifest.version));
assert.ok(evaluatePluginCompatibility({...vcsManifest,version:'0.4.10',peerDependencies:{'@deepseek-ai/dsh':'0.1.7-rc.2 || 0.2.0-rc.2'}},{},'0.2.1-rc.2'));
assert.ok(evaluatePluginCompatibility({...vcsManifest,peerDependencies:{'@deepseek-ai/dsh':supportedHosts.filter(v=>v!=='0.2.1-rc.5').join(' || ')}},{},'0.2.1-rc.5'));
console.log('Actual host peer gate accepts only declared versions, including 0.2.1-rc.5, and rejects the previous range; no exemption.');
const {Context}=await import(pathToFileURL(requireHost.resolve('@deepseek-ai/cordis')));
const connectionPlugin=await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-client-connection')));
const rendererDeps=new Map();
for(const name of ['react','react-dom','react-dom/client','react/jsx-runtime','@deepseek-ai/cordis'])rendererDeps.set(name,await import(pathToFileURL((name.startsWith('react')?createRequire(import.meta.url):requireHost).resolve(name))));
// Desktop builds can seed ui-slots in the shell instead of shipping its Node package.
// Accept an explicit, same-version unpacked seed manifest; never silently use a mock.
const slotsManifest=process.argv[3]?path.resolve(process.argv[3]):requireHost.resolve('@deepseek-ai/dsh-client-ui-slots/package.json');
const slotsPackage=JSON.parse(await readFile(slotsManifest,'utf8'));
assert.equal(slotsPackage.name,'@deepseek-ai/dsh-client-ui-slots');
assert.equal(slotsPackage.version,hostManifest.version);
rendererDeps.set(slotsPackage.name,await import(pathToFileURL(path.resolve(path.dirname(slotsManifest),slotsPackage.main))));
let renderer;
vm.runInNewContext(await readFile(requireHost.resolve('@deepseek-ai/dsh-client-ui-renderer/client'),'utf8'),{window:{__ModuleLoader__:{load(row){renderer=row.factory(name=>{assert.ok(rendererDeps.has(name),name);return rendererDeps.get(name);});}}},console,queueMicrotask,AbortController});
const {SlotRegistry}=renderer;
const ctx=new Context(),routes=new Map();
let cookie='';
try{
 ctx.provide('webServer',{register(route){assert.equal(routes.has(route.path),false);routes.set(route.path,route);return ()=>routes.delete(route.path);}});
 ctx.provide('sessions',new Map());ctx.provide('sessionPersistence',{stat:async()=>undefined});
 const credentials=new Map();ctx.provide('credentials',{async modifyRecord(key,update){const decision=await update(credentials.get(key));if(decision?.kind==='grant')credentials.set(key,decision);else if(decision?.kind==='revoke')credentials.delete(key);return credentials.get(key);}});
 await connectionPlugin.apply(ctx,{});
 const oldHost=['0.1.7-rc.2','0.2.0-rc.2'].includes(hostManifest.version),hostRoutes=oldHost?['/api']:['/api','/connect'];
 assert.deepEqual([...routes.keys()].sort(),hostRoutes,'Exact host carrier contract');
 const fiber=await ctx.plugin(plugin);
 for(const [name,route] of routes)assert.equal(route.kind,['/vcs-rpc','/api'].includes(name)?'prefix':'exact');
 assert.deepEqual([...routes.keys()].sort(),[...hostRoutes,'/vcs-assets/editor.css','/vcs-assets/editor.js','/vcs-assets/editor.worker.js','/vcs-assets/frontend.json','/vcs-assets/interface.js','/vcs-rpc']);
 for(const [name,route] of routes){if(name==='/connect')continue;
  let status,ended=false;await route.handler({method:'GET',headers:{host:'127.0.0.1:3080'}},{writeHead(n){status=n;},end(){ended=true;}});
  assert.equal(status,401);assert.equal(ended,true);
 }
 const url=new URL(ctx.connection.authenticatedUrl('http://127.0.0.1:3080/'));let authStatus,authHeaders;
 assert.equal(ctx.connection.authorizeIndex({method:'GET',url:url.pathname+url.search,headers:{host:url.host}},{writeHead(status,headers){authStatus=status;authHeaders=headers;},end(){}}),false);assert.equal(authStatus,303);
 cookie=String(authHeaders['set-cookie']).split(';')[0];assert.ok(cookie.includes('='),'Real cookie exchange must set session cookie');
 const request={headers:{host:'127.0.0.1:3080',cookie}};
 assert.equal(ctx.connection.admit({headers:{host:'127.0.0.1:3080',cookie:cookie+'tampered'}}).rejection,401);const admission=ctx.connection.admit(request);assert.ok('peer' in admission);const peer=admission.peer;
 assert.equal(ctx.connection.admit({headers:{host:'evil.invalid'}}).rejection,403);
 const fetcher=ctx.connection.createSharedFetchHandler('/api');
 if(['0.1.7-rc.2','0.2.0-rc.2'].includes(hostManifest.version)){
  // This exact official host has one lifetime OperatorPeer and no guest API.
  // Its shared fetch helper is downstream of HTTP admission, not a peer fence.
  assert.equal(ctx.connection.createPeer,undefined);assert.equal(peer,ctx.connection.operator);
  assert.equal(ctx.connection.admit({headers:{host:'127.0.0.1:3080'}}).rejection,401);
  for(const route of routes.values()){let status;await route.handler({method:'GET',headers:{host:'127.0.0.1:3080'}},{writeHead(value){status=value;},end(){}});assert.equal(status,401);}
  assert.equal(ctx.connection.admit(request).peer,ctx.connection.operator);
 }else{
  assert.equal(typeof ctx.connection.createPeer,'function','Expected principal-aware peer API');
  const guest=ctx.connection.createPeer({principal:{kind:'guest'}});
  try{assert.equal((await fetcher.fetch(new Request('http://127.0.0.1:3080/api/vcs-assets/editor.css'),guest)).status,403);}finally{await guest.dispose();}
 }
 const direct=async(name,url,method='GET')=>{
  let status,body;await routes.get('/vcs-assets/'+name).handler({method,url,headers:request.headers},{writeHead(code){status=code;},end(value){body=value;}});
  return {status,body};
 };
 const frontend=await direct('frontend.json','/vcs-assets/frontend.json');assert.equal(frontend.status,200);
 const frontendManifest=JSON.parse(frontend.body);assert.equal(frontendManifest.version,vcsManifest.version);
 assert.equal((await direct('interface.js','/vcs-assets/interface.js')).status,409);
 assert.equal((await direct('editor.js','/vcs-assets/editor.js','HEAD')).body,undefined);
 assert.equal((await direct('editor.js','/vcs-assets/editor.js','POST')).status,405);
 const asset=await fetcher.fetch(new Request('http://127.0.0.1:3080/api/vcs-assets/editor.css'),peer);assert.equal(asset.status,200);assert.ok((await asset.text()).length>0);
 // Call the production registered Node route, including admission and HTTP bridge.
 // These streams do not open a listener or touch the running profile.
 const routeRequest=async(endpoint,body,contentType='application/json',host='127.0.0.1:3080',carrier='/vcs-rpc',authCookie=cookie)=>{
  const req=Readable.from(body?[Buffer.from(body)]:[]);
  Object.assign(req,{url:carrier+'/'+endpoint,method:carrier==='/api'?'GET':'POST',headers:{host,cookie:authCookie,'content-type':contentType}});
  const chunks=[];let status;
  const res=new Writable({write(chunk,encoding,done){chunks.push(Buffer.from(chunk));done();}});
  res.writeHead=code=>{status=code;};
  await routes.get(carrier).handler(req,res);
  return {status,text:Buffer.concat(chunks).toString('utf8')};
 };
 for(const [auth,host,status] of [['','127.0.0.1:3080',401],[cookie+'tampered','127.0.0.1:3080',401],[cookie,'evil.invalid',403],[cookie,'127.0.0.1:3080',200]])assert.equal((await routeRequest('vcs-assets/editor.css','','application/json',host,'/api',auth)).status,status,'Real /api cookie carrier');
 assert.equal((await routeRequest('vcs/unknown','{}','text/plain')).status,415);
 assert.equal((await routeRequest('vcs/unknown','{')).status,400);
 assert.equal((await routeRequest('vcs/unknown','{}','application/json','evil.invalid')).status,403);
 const invoke=async(method,payload)=>{
  const response=await routeRequest(method,JSON.stringify({type:'client-request',rpcId:'compat-test',method,payload}));
  assert.equal(response.status,200,response.text);const body=JSON.parse(response.text);assert.equal(body.type,'server-response');assert.equal(body.rpcId,'compat-test');return body.result;
 };
 assert.equal((await invoke('vcs/unknown',{})).error.code,'vcs/not-found');
 assert.equal((await invoke('vcs/repositories',{sessionId:'missing'})).error.code,'vcs/session-unavailable');
 assert.equal((await invoke('vcs/repositories',{sessionId:'missing',cwd:'/untrusted'})).error.code,'vcs/invalid-request');
 ctx.sessions.set('fixture',{header:{cwd:process.cwd()}});
 assert.equal(await resolveSessionCwd(ctx,'fixture'),process.cwd());
 assert.equal((await invoke('vcs/status',{sessionId:'fixture',repositoryId:'not-granted'})).error.code,'vcs/rediscover-required');
 assert.equal((await invoke('vcs/svn-describe',{sessionId:'fixture',repositoryId:'not-granted'})).error.code,'vcs/rediscover-required');
 await checkBranchSwitchRpc(ctx,invoke);
 await fiber.dispose();assert.deepEqual([...routes.keys()].sort(),hostRoutes);
 assert.equal((await fetcher.fetch(new Request('http://127.0.0.1:3080/api/vcs-assets/editor.css'),peer)).status,404);
 const reloaded=await ctx.plugin(plugin);assert.equal(routes.size,hostRoutes.length+6);await reloaded.dispose();assert.deepEqual([...routes.keys()].sort(),hostRoutes);
 const clientCtx=new Context();
 try{
  new SlotRegistry(clientCtx);
  clientCtx.provide('locale',{register:()=>()=>{},bind:()=>key=>key});
  clientCtx.provide('layout',{selectPanel(){throw Error('Unexpected navigation');}});
  clientCtx.provide('connection',{rpc:{call(){throw Error('Unexpected activation RPC');}}});clientCtx.provide('uiSession',{});
  clientCtx.provide('remote',{});clientCtx.provide('remote.pluginManager',{});
  clientCtx.slots.register({name:'root',children:{main:{kind:'keyed',scope:'root'},'sidebar.panellist':{kind:'list',scope:'root'}}},()=>null);
  // Use the installed host's lazy module system, not an eager factory substitute.
  let moduleApi;
  vm.runInNewContext(await readFile(requireHost.resolve('@deepseek-ai/dsh-client-modules/client'),'utf8'),{window:{__ModuleLoader__:{load(row){moduleApi=row.factory(name=>{throw Error('Unexpected module-system dependency: '+name);});}}},URL,AbortController,console});
  const target={mode:'queue',pendingQueue:[],load(row){this.pendingQueue.push(row);}};
  vm.runInNewContext(await readFile(new URL('../dist/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:target},URL,AbortController,console});
  assert.equal(target.pendingQueue.length,1);assert.equal(target.pendingQueue[0].id,vcsManifest.name);
  assert.equal(clientCtx.slots.entries('main').length,0,'Bundle registration must not activate the plugin');
  const modules=new moduleApi.ClientModuleSystem({manifest:{modules:[]},staticModules:{react:React},registrationTarget:target,bootstrapModule:{id:'compat-fixture',exports:{}},loadBundle:async()=>{throw Error('Unexpected network bundle request');}});
  assert.equal(modules.loadCache.has(vcsManifest.name),false,'Registration must remain lazy');
  const client=await modules.import(vcsManifest.name);
  assert.equal(await modules.import(vcsManifest.name+'/client'),client,'Client alias must reuse materialized exports');
  const loaded=await clientCtx.plugin(client);
  assert.equal(clientCtx.slots.entries('main').length,1);assert.equal(clientCtx.slots.entries('sidebar.panellist').length,1);assert.equal(clientCtx.slots.entries('root').length,1);
  await loaded.dispose();assert.equal(clientCtx.slots.entries('main').length,0);assert.equal(clientCtx.slots.entries('sidebar.panellist').length,0);assert.equal(clientCtx.slots.entries('root').length,1);
 }finally{await clientCtx.fiber.dispose();}
 console.log('Real client SlotRegistry load/unload passed with fixture shell/locale; not actual page rendering.');
 console.log('Real Cordis/Connection registration, admission, assets and disposal passed; not live GUI acceptance.');
}finally{await ctx.fiber.dispose();}
if(process.env.DSH_COMPAT_REPORT)await writeFile(process.env.DSH_COMPAT_REPORT,JSON.stringify({schema:1,...await verifyConsumedCandidate(process.env.DSH_CANDIDATE_RECEIPT||'consumed-candidate.json'),ref:process.env.GITHUB_REF,refType:process.env.GITHUB_REF_TYPE,hostVersion:hostManifest.version,pluginVersion:vcsManifest.version,tag:process.env.RELEASE_TAG,sha:process.env.RELEASE_SHA,runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT,tools:{node:process.version,host:hostManifest.version,slots:slotsPackage.version},passed:true,contracts:['peer-gate','registration','authentication','session','assets','rpc','branch-switch-rpc','lazy-client','dispose-reload']},null,2)+'\n');
