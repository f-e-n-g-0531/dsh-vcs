import test from 'node:test';import assert from 'node:assert/strict';import {createSvnRpc} from '../src/svn-rpc.mjs';import {createClientRpc} from '../src/client-rpc.mjs';
// Same required generic failure fields as DSH connection's parseConnectionResponse.
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
function hostParse(result){const value=JSON.parse(JSON.stringify({type:'server-response',rpcId:'fixture',result}));assert.equal(value.type,'server-response');assert.ok(record(value.result));if(value.result.ok!==true){const error=value.result.error;if(value.result.ok!==false||!record(error)||typeof error.code!=='string'||typeof error.message!=='string'||!record(error.details))throw new TypeError('connection: invalid server-response failure');}return value.result;}
const address={sessionId:'s',repositoryId:'r'},params={...address,token:'a'.repeat(64),snapshot:'9'};
test('every SVN failure branch satisfies host failure contract and preserves underlying error',async()=>{
 assert.throws(()=>hostParse({ok:false,error:{code:'vcs/operation-failed',message:'hidden'}}),/invalid server-response failure/);
 const runtime={log:async()=>{throw Error('HTTPS status 401');}},rpc=createSvnRpc(runtime),client=createClientRpc({rpc:{call:async(_channel,endpoint,p,signal)=>hostParse(await rpc(endpoint,p,signal))}},()=> 'fallback');
 await assert.rejects(client('vcs/svn-log',params),e=>e.code==='vcs/operation-failed'&&e.message==='HTTPS status 401');
 for(const result of [await rpc('vcs/svn-unknown',address),await rpc('vcs/svn-log',{...params,snapshot:9})]){assert.equal(hostParse(result).ok,false);assert.deepEqual(result.error.details,{});}
 for(const code of ['vcs/rediscover-required','vcs/svn-consent-required']){const scoped=createSvnRpc({log:async()=>{throw Object.assign(Error('scope expired'),{code});}});assert.equal(hostParse(await scoped('vcs/svn-log',params)).error.code,code);}
 const c=new AbortController();c.abort();assert.equal(hostParse(await rpc('vcs/svn-log',params,c.signal)).error.code,'vcs/cancelled');
});
test('busy and deadline SVN failures survive host JSON transport validation',async()=>{
 const finish=[],rpc=createSvnRpc({describe:async()=>new Promise(resolve=>finish.push(resolve))});const one=rpc('vcs/svn-describe',address),two=rpc('vcs/svn-describe',address);assert.equal(hostParse(await rpc('vcs/svn-describe',address)).error.code,'vcs/busy');finish.forEach(resolve=>resolve({}));await Promise.all([one,two]);
 const timed=createSvnRpc({describe:async(_a,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))},{timeoutMs:5});const result=hostParse(await timed('vcs/svn-describe',address));assert.equal(result.ok,false);assert.match(result.error.message,/deadline/);assert.deepEqual(result.error.details,{});
});
