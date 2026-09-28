import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, resolveSessionCwd, registerAssets, RPC_CHANNEL, apply } from '../index.mjs';
const ctx = { sessions: { get: () => ({ header: { cwd: '/workspace' } }) }, sessionPersistence: { stat: async () => undefined } };
const repo = { id: 'git-one', type: 'git', root: '/workspace/one', relativePath: 'one', branch: 'main' };
const svn = { id: 'svn-two', type: 'svn', root: '/workspace/two', relativePath: 'two' };
const discovered = (repositories = [repo]) => ({ repositories, truncated: false, warnings: [] });
const api = { discoverRepositories: async cwd => { assert.equal(cwd, '/workspace'); return discovered(); }, listChanges: async () => [{ id: 'file', path: 'file' }], getComparison: async () => ({ path: 'file', left: { text: 'before' }, right: { text: 'after' } }) };
const request = { sessionId: 'session-1', repositoryId: repo.id, mode: 'all' };
const discover = (call, extra = {}) => call('vcs/repositories', { sessionId: request.sessionId, ...extra });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('custom authenticated RPC channel and fixed asset registration are preserved', () => {
 assert.equal(RPC_CHANNEL, '/vcs-rpc');
 const channels = [], routes = [];
 apply({ ...ctx, effect: fn=>fn(), webServer:{register:()=>()=>{}}, connection: { register: (owner,...args) => channels.push(args), fetch: { register: route => routes.push(route) } } });
 assert.equal(channels[0][0], RPC_CHANNEL); assert.equal(typeof channels[0][1], 'function'); assert.equal(routes.length, 3);
});
test('discovery grants access to a selected repository; status has no implicit fallback', async () => {
 const call = createHandler(ctx, api);
 assert.equal((await call('vcs/status', request)).error.code, 'vcs/rediscover-required');
 assert.equal((await call('vcs/status', {sessionId: request.sessionId})).error.code, 'vcs/invalid-request');
 assert.deepEqual((await discover(call)).value, {cwd:'/workspace', ...discovered()});
 assert.deepEqual((await call('vcs/status', request)).value, {cwd:'/workspace',repository:repo,changes:[{id:'file',path:'file'}],mode:'all'});
});
test('cold Session metadata lookup does not activate an Agent', async () => {
 const cold = { sessions:{get:()=>undefined},sessionPersistence:{stat:async()=>({header:{cwd:'/cold'}})} };
 assert.equal(await resolveSessionCwd(cold,'cold-1'), '/cold');
 await assert.rejects(resolveSessionCwd(cold,'../unsafe'));
 assert.equal((await createHandler({...cold,sessionPersistence:{stat:async()=>undefined}}, api)('vcs/repositories',{sessionId:'missing'})).error.code,'vcs/session-unavailable');
});
test('foreign repository IDs and other Sessions cannot use discovery grants', async () => {
 const call = createHandler(ctx, api); await discover(call);
 for (const change of [{repositoryId:'foreign'}, {repositoryId:'/workspace/one'}, {sessionId:'session-2'}]) {
  for (const endpoint of ['vcs/status','vcs/compare']) assert.equal((await call(endpoint,{...request,...change,...(endpoint==='vcs/compare'?{id:'file'}:{})})).error.code,'vcs/rediscover-required');
 }
 await discover(call,{sessionId:'session-2'});
 assert.equal((await call('vcs/status',{...request,sessionId:'session-2'})).ok,true);
});
test('compare delegates once directly to adapter with authorized repository', async () => {
 let calls = 0;
 const call = createHandler(ctx, {...api,listChanges:async()=>{throw new Error('redundant list');}, getComparison:async(r, options)=>{
  calls++;assert.deepEqual(r,repo);assert.deepEqual(options,{mode:'staged',id:'file'});return {left:{text:'before'}};
 }});
 await discover(call);
 assert.equal((await call('vcs/compare',{...request,mode:'staged',id:'file'})).value.left.text,'before');assert.equal(calls,1);
});
test('empty discovery succeeds without implicitly enabling status', async () => {
 const call=createHandler(ctx,{...api,discoverRepositories:async()=>discovered([])});
 assert.deepEqual((await discover(call)).value,{cwd:'/workspace',...discovered([])});
 assert.equal((await call('vcs/status',request)).error.code,'vcs/rediscover-required');
});
test('mixed Git/SVN status requests fail independently and enforce supported modes', async () => {
 const call=createHandler(ctx,{...api,discoverRepositories:async()=>discovered([repo,svn]),listChanges:async r=>{if(r.type==='git')throw new Error('Git failed');return [];}});
 await discover(call);
 assert.equal((await call('vcs/status',request)).error.code,'vcs/operation-failed');
 assert.equal((await call('vcs/status',{...request,repositoryId:svn.id})).ok,true);
 for(const mode of ['staged','unstaged']) assert.equal((await call('vcs/status',{...request,repositoryId:svn.id,mode})).error.code,'vcs/invalid-request');
 const git=createHandler(ctx,api);await discover(git);
 for(const mode of ['all','staged','unstaged']) assert.equal((await git('vcs/status',{...request,mode})).ok,true);
});
test('invalid payload, directory overrides and invalid targeted paths are rejected', async () => {
 const call=createHandler(ctx,api);
 for(const payload of [null,[],{...request,mode:'bad'},{...request,sessionId:'../bad'},{...request,repositoryId:3},{...request,cwd:'/evil'},{...request,root:'/evil'},{...request,directory:'/evil'},{...request,extra:true}]) assert.equal((await call('vcs/status',payload)).error.code,'vcs/invalid-request');
 for(const id of ['',42,null]) assert.equal((await call('vcs/compare',{...request,id})).error.code,'vcs/invalid-request');
 for(const subdirectory of ['',3,'../evil','a/../evil','/evil','C:/evil','C:evil','\\evil','a\\..\\evil','a\0b']) assert.equal((await discover(call,{subdirectory})).error.code,'vcs/invalid-request');
 assert.equal((await discover(call,{cwd:'/evil'})).error.code,'vcs/invalid-request');
 assert.equal((await call('unknown',request)).error.code,'vcs/not-found');
});
test('targeted discovery forwards scope and signal, merges grants and preserves warnings', async () => {
 const controller=new AbortController();
 const call=createHandler(ctx,{...api,discoverRepositories:async(cwd,options)=>{
  assert.equal(cwd,'/workspace');
  if(options.subdirectory){assert.equal(options.subdirectory,'deep/project');assert.equal(options.signal,controller.signal);return {...discovered([svn]),truncated:true,warnings:['limit']};}
  return discovered();
 }});
 await discover(call);
 assert.deepEqual((await call('vcs/repositories',{sessionId:request.sessionId,subdirectory:'deep/project'},controller.signal)).value,{cwd:'/workspace',repositories:[svn],truncated:true,warnings:['limit']});
 for(const repositoryId of [repo.id,svn.id]) assert.equal((await call('vcs/status',{...request,repositoryId})).ok,true);
});
test('concurrent targeted discoveries merge without dropping completed grants', async () => {
 const entered=deferred(),release=deferred();
 const call=createHandler(ctx,{...api,discoverRepositories:async(cwd,{subdirectory})=>{
  if(subdirectory==='slow'){entered.resolve();await release.promise;return discovered([svn]);}
  return discovered();
 }});
 const slow=discover(call,{subdirectory:'slow'});await entered.promise;
 assert.equal((await discover(call,{subdirectory:'fast'})).ok,true);release.resolve();assert.equal((await slow).ok,true);
 for(const repositoryId of [repo.id,svn.id]) assert.equal((await call('vcs/status',{...request,repositoryId})).ok,true);
});
test('full rediscovery replaces grants and discards in-flight reads of removed repositories', async () => {
 let repositories=[repo,svn];const entered=deferred(),release=deferred();
 const call=createHandler(ctx,{...api,discoverRepositories:async()=>discovered(repositories),listChanges:async()=>{entered.resolve();await release.promise;return [];}});
 await discover(call);const pending=call('vcs/status',request);await entered.promise;
 repositories=[svn];assert.equal((await discover(call)).ok,true);release.resolve();
 assert.equal((await pending).error.code,'vcs/rediscover-required');
 assert.equal((await call('vcs/status',request)).error.code,'vcs/rediscover-required');
 assert.equal((await call('vcs/status',{...request,repositoryId:svn.id})).ok,true);
});
test('late full scan cannot replace a newer full or targeted scan', async () => {
 for(const newer of [{},{subdirectory:'new'}]) {
  const entered=deferred(),release=deferred();let scans=0;
  const call=createHandler(ctx,{...api,discoverRepositories:async()=>{if(++scans===1){entered.resolve();await release.promise;return discovered();}return discovered([svn]);}});
  const old=discover(call);await entered.promise;assert.equal((await discover(call,newer)).ok,true);release.resolve();
  assert.equal((await old).error.code,'vcs/rediscover-required');
  assert.equal((await call('vcs/status',request)).error.code,'vcs/rediscover-required');
  assert.equal((await call('vcs/status',{...request,repositoryId:svn.id})).ok,true);
 }
});
test('late targeted scan cannot resurrect grants after a newer full scan', async () => {
 const entered=deferred(),release=deferred();
 const call=createHandler(ctx,{...api,discoverRepositories:async(cwd,{subdirectory})=>{if(subdirectory){entered.resolve();await release.promise;return discovered();}return discovered([svn]);}});
 const old=discover(call,{subdirectory:'old'});await entered.promise;await discover(call);release.resolve();
 assert.equal((await old).error.code,'vcs/rediscover-required');
 assert.equal((await call('vcs/status',request)).error.code,'vcs/rediscover-required');
});
test('adapter root revalidation errors are propagated without fallback', async () => {
 let called=0;const reject=async r=>{called++;assert.deepEqual(r,repo);throw Object.assign(new Error('Repository root changed; rediscover.'),{code:'vcs/rediscover-required'});};
 const call=createHandler(ctx,{...api,listChanges:reject,getComparison:reject});await discover(call);
 assert.equal((await call('vcs/status',request)).error.code,'vcs/rediscover-required');
 assert.equal((await call('vcs/compare',{...request,id:'file'})).error.code,'vcs/rediscover-required');assert.equal(called,2);
});
test('cache expires after five minutes without status extending authorization', async () => {
 let clock=0;const call=createHandler(ctx,api,4,{now:()=>clock});await discover(call);
 clock=299999;assert.equal((await call('vcs/status',request)).ok,true);
 clock=300000;const result=await call('vcs/status',request);assert.equal(result.error.code,'vcs/rediscover-required');assert.match(result.error.message,/Rediscover/);
 await discover(call);assert.equal((await call('vcs/status',request)).ok,true);
});
test('cache bounds Sessions and total targeted repository grants', async () => {
 const call=createHandler(ctx,api);
 for(let i=0;i<33;i++) await discover(call,{sessionId:'s'+i});
 assert.equal((await call('vcs/status',{...request,sessionId:'s0'})).error.code,'vcs/rediscover-required');
 assert.equal((await call('vcs/status',{...request,sessionId:'s32'})).ok,true);
 const bounded=createHandler(ctx,{...api,discoverRepositories:async()=>discovered([repo,svn])},4,{maxRepositories:1});
 const result=await discover(bounded);assert.equal(result.value.truncated,true);assert.equal(result.value.repositories.length,1);assert.equal(result.value.warnings.length,1);
 assert.equal((await bounded('vcs/status',{...request,repositoryId:svn.id})).error.code,'vcs/rediscover-required');
});
test('cwd changes invalidate grants; a stale scan cannot overwrite newer cwd discovery', async () => {
 let cwd='/old';const entered=deferred(),release=deferred();
 const changing={...ctx,sessions:{get:()=>({header:{cwd}})}};
 const call=createHandler(changing,{...api,discoverRepositories:async dir=>{if(dir==='/old'){entered.resolve();await release.promise;return discovered();}return discovered([svn]);}});
 const old=discover(call);await entered.promise;cwd='/new';
 assert.equal((await discover(call)).value.cwd,'/new');release.resolve();
 assert.equal((await old).error.code,'vcs/rediscover-required');
 assert.equal((await call('vcs/status',{...request,repositoryId:svn.id})).ok,true);
 assert.equal((await call('vcs/status',request)).error.code,'vcs/rediscover-required');
 cwd='/third';assert.equal((await call('vcs/status',{...request,repositoryId:svn.id})).error.code,'vcs/rediscover-required');
});
test('cwd changes during status discard stale results even without another request', async () => {
 let cwd='/workspace';const entered=deferred(),release=deferred();
 const call=createHandler({...ctx,sessions:{get:()=>({header:{cwd}})}},{...api,listChanges:async()=>{entered.resolve();await release.promise;return [];}});
 await discover(call);const pending=call('vcs/status',request);await entered.promise;cwd='/changed';release.resolve();
 assert.equal((await pending).error.code,'vcs/rediscover-required');
});
test('cancellation does not grant repositories and capacity is released', async () => {
 const entered=deferred(),release=deferred();const controller=new AbortController();
 const call=createHandler(ctx,{...api,discoverRepositories:async()=>{entered.resolve();await release.promise;return discovered();}},1);
 const first=call('vcs/repositories',{sessionId:request.sessionId},controller.signal);await entered.promise;
 assert.equal((await discover(call)).error.code,'vcs/busy');controller.abort();release.resolve();
 assert.equal((await first).error.code,'vcs/cancelled');
 assert.equal((await call('vcs/status',request)).error.code,'vcs/rediscover-required');
 assert.equal((await discover(call)).ok,true);
});
test('asset registration is fixed and supports HEAD without body',async()=>{
 const routes=[];registerAssets({connection:{fetch:{register:r=>routes.push(r)}}},async name=>Buffer.from(name));
 assert.deepEqual(routes.map(r=>r.path),['/api/vcs-assets/editor.js','/api/vcs-assets/editor.css','/api/vcs-assets/editor.worker.js']);
 const get=await routes[0].fetch(new Request('http://localhost/api/vcs-assets/editor.js'));
 assert.equal(await get.text(),'editor.js'); assert.equal(get.headers.get('x-content-type-options'),'nosniff');
 const head=await routes[1].fetch(new Request('http://localhost/api/vcs-assets/editor.css',{method:'HEAD'}));
 assert.equal(await head.text(),'');assert.equal(head.headers.get('content-type'),'text/css; charset=utf-8');
});
