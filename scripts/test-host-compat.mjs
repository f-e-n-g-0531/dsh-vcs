import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {apply,createHandler,resolveSessionCwd} from '../index.mjs';
// Explicit installed DSH package path; no profile boot, HTTP listener, or user credentials.
const manifest=process.argv[2];
if(!manifest)throw Error('Usage: node scripts/test-host-compat.mjs <installed-dsh-package.json>');
const requireHost=createRequire(path.resolve(manifest));
const {Context}=await import(pathToFileURL(requireHost.resolve('@deepseek-ai/cordis')));
const {HostConnectionService}=await import(pathToFileURL(requireHost.resolve('@deepseek-ai/dsh-client-connection')));
const ctx=new Context(),routes=new Map();
let authenticated=false;
try{
 ctx.provide('webServer',{register(route){assert.equal(routes.has(route.path),false);routes.set(route.path,route);return ()=>routes.delete(route.path);}});
 ctx.provide('sessions',new Map());ctx.provide('sessionPersistence',{stat:async()=>undefined});
 new HostConnectionService(ctx,[],{isAuthenticated:()=>authenticated});
 apply(ctx);
 assert.deepEqual([...routes.keys()].sort(),['/vcs-assets/editor.css','/vcs-assets/editor.js','/vcs-assets/editor.worker.js','/vcs-rpc']);
 for(const route of routes.values()){
  let status,ended=false;await route.handler({method:'GET',headers:{host:'127.0.0.1:3080'}},{writeHead(n){status=n;},end(){ended=true;}});
  assert.equal(status,401);assert.equal(ended,true);
 }
 authenticated=true;
 const request={headers:{host:'127.0.0.1:3080'}};assert.ok('peer' in ctx.connection.admit(request));
 assert.equal(ctx.connection.admit({headers:{host:'evil.invalid'}}).rejection,403);
 const fetcher=ctx.connection.createSharedFetchHandler('/api');
 const asset=await fetcher.fetch(new Request('http://127.0.0.1:3080/api/vcs-assets/editor.css'));assert.equal(asset.status,200);assert.ok((await asset.text()).length>0);
 // Exercise real Connection envelope transport in memory. This shared test channel
 // uses the same plugin handler but does not claim to exercise the Node HTTP bridge.
 ctx.connection.rpc.intercept('/api',endpoint=>endpoint.startsWith('vcs/'),createHandler(ctx));
 const invoke=async(method,payload)=>{
  const response=await fetcher.fetch(new Request('http://127.0.0.1:3080/api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'compat-test',method,payload})}));
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.type,'server-response');assert.equal(body.rpcId,'compat-test');return body.result;
 };
 assert.equal((await invoke('vcs/unknown',{})).error.code,'vcs/not-found');
 assert.equal((await invoke('vcs/repositories',{sessionId:'missing'})).error.code,'vcs/session-unavailable');
 assert.equal((await invoke('vcs/repositories',{sessionId:'missing',cwd:'/untrusted'})).error.code,'vcs/invalid-request');
 ctx.sessions.set('fixture',{header:{cwd:process.cwd()}});
 assert.equal(await resolveSessionCwd(ctx,'fixture'),process.cwd());
 assert.equal((await invoke('vcs/status',{sessionId:'fixture',repositoryId:'not-granted'})).error.code,'vcs/rediscover-required');
 await ctx.fiber.dispose();assert.equal(routes.size,0);
 assert.equal((await fetcher.fetch(new Request('http://127.0.0.1:3080/api/vcs-assets/editor.css'))).status,404);
 console.log('Real Cordis/Connection registration, admission, assets and disposal passed; not live GUI acceptance.');
}finally{await ctx.fiber.dispose();}
