import test from 'node:test';import assert from 'node:assert/strict';import {createSvnRuntime} from '../src/svn-runtime.mjs';import {createSvnRpc} from '../src/svn-rpc.mjs';
const address={sessionId:'s',repositoryId:'r'},identity={cwd:'C:/wc',root:'https://example.test/repo',uuid:'12345678-1234-1234-1234-123456789abc',scope:'/scope',revision:'9'};
test('copy source active cancellation waits for adapter cleanup and rejects changed identity',async()=>{
 let current=identity,finish;let entered;const started=new Promise(resolve=>entered=resolve);const runtime=createSvnRuntime({resolveIdentity:async()=>current,transport:async plan=>{if(plan.args.includes('--verbose'))return '<log><logentry revision="9"><paths><path action="A" kind="file" copyfrom-path="/scope/old" copyfrom-rev="7">/scope/new</path></paths></logentry></log>';entered();return new Promise(resolve=>finish=()=>resolve('<log/>'));}}),rpc=createSvnRpc(runtime);
 const offer=await runtime.describe(address),grant=await runtime.approve(address,{offer:offer.offer,explicit:true}),detail=await runtime.detail(address,{token:grant.token,snapshot:'9',revision:'9'}),p={...address,token:grant.token,snapshot:'9',revision:'9',id:detail.changes[0].id};
 const controller=new AbortController(),request=rpc('vcs/svn-copytrace',p,controller.signal);await started;controller.abort();current={...identity,cwd:'C:/changed'};assert.equal((await rpc('vcs/svn-copytrace',p)).ok,false);current=identity;finish();assert.equal((await request).error.code,'vcs/cancelled');runtime.dispose();
});

test('copy source history revalidates opaque member and confines numeric peg without path input',async()=>{
 const calls=[];let source='/scope/old',action='A';
 const runtime=createSvnRuntime({resolveIdentity:async()=>identity,transport:async plan=>{calls.push(plan);if(plan.args.includes('--verbose'))return '<log><logentry revision="9"><paths><path action="'+action+'" kind="file"'+(action==='A'?' copyfrom-path="'+source+'" copyfrom-rev="7"':'')+'>/scope/new</path></paths></logentry></log>';return '<log><logentry revision="7"><msg>source</msg></logentry></log>';}}),rpc=createSvnRpc(runtime);
 const offer=await runtime.describe(address),grant=await runtime.approve(address,{offer:offer.offer,explicit:true}),p={...address,token:grant.token,snapshot:'9',revision:'9'};const detail=await runtime.detail(address,p);p.id=detail.changes[0].id;
 const result=await rpc('vcs/svn-copytrace',p);assert.ok(result.ok);assert.equal(result.value.path,'/scope/old');assert.equal(result.value.pegRevision,'7');assert.equal(calls.at(-1).args.at(-1),'https://example.test/repo/scope/old@7');
 for(const extra of [{path:'/outside'},{cursor:'8'},{id:'f'.repeat(64)}])assert.equal((await rpc('vcs/svn-copytrace',{...p,...extra})).ok,false);
 source='/outside/old';const outside=await runtime.detail(address,p);assert.equal(outside.changes[0].copySourceOutsideScope,true);const count=calls.length;assert.equal((await rpc('vcs/svn-copytrace',{...p,id:outside.changes[0].id})).ok,false);assert.equal(calls.length,count+1);
 action='M';const modified=await runtime.detail(address,p);assert.equal((await rpc('vcs/svn-copytrace',{...p,id:modified.changes[0].id})).ok,false);
 await runtime.revoke(address,{token:grant.token});assert.equal((await rpc('vcs/svn-copytrace',p)).ok,false);runtime.dispose();
});
