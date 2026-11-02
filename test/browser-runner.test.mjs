import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {connectCdp,observeChild,waitForDevTools,stopBrowser,within,browserSpawnOptions} from '../scripts/browser-runner.mjs';
class Socket {
 sent=[];closed=false;
 send(text){this.sent.push(JSON.parse(text));}
 close(){this.closed=true;this.onclose?.();}
 reply(value){this.onmessage({data:JSON.stringify(value)});}
}
async function connect(options={}){const socket=new Socket();const pending=connectCdp(socket,options);socket.onopen();return {socket,client:await pending};}
test('CDP resolves matching results and errors, ignores events and late unknown replies',async()=>{
 const {socket,client}=await connect();
 try{
  const result=client.call('Runtime.evaluate',{expression:'1'});socket.reply({method:'Page.ready'});socket.reply({id:socket.sent[0].id,result:{value:1}});
  assert.deepEqual(await result,{value:1});assert.equal(client.pendingCount,0);
  const error=client.call('Bad');socket.reply({id:socket.sent[1].id,error:{message:'bad'}});await assert.rejects(error,/bad/);
  socket.reply({id:999,result:{}});assert.equal(client.pendingCount,0);
 }finally{client.close();}
});
test('CDP commands time out independently and clear pending entries',async()=>{
 const {socket,client}=await connect({commandTimeoutMs:20});
 try{
  await assert.rejects(client.call('hang'),/timed out: hang/);assert.equal(client.pendingCount,0);
  socket.reply({id:1,result:{late:true}});
  const recovery=client.call('ok');socket.reply({id:2,result:{ok:true}});assert.deepEqual(await recovery,{ok:true});
 }finally{client.close();}
});
test('socket close, error and malformed replies reject all outstanding work',async()=>{
 for(const event of ['close','error','malformed']){
  const {socket,client}=await connect();
  const one=assert.rejects(client.call('one')),two=assert.rejects(client.call('two'));
  if(event==='close')socket.close();else if(event==='error')socket.onerror();else socket.onmessage({data:'not json'});
  await Promise.all([one,two]);assert.equal(client.pendingCount,0);await assert.rejects(client.call('later'));client.close();
 }
});
test('connection handshake has deadline and child exit rejects pending CDP',async()=>{
 const socket=new Socket();await assert.rejects(connectCdp(socket,{connectTimeoutMs:20}),/connection timed out/);assert.equal(socket.closed,true);
 const child=new EventEmitter();child.exitCode=null;child.signalCode=null;const state=observeChild(child);
 const {client}=await connect({childState:state});
 const failure=assert.rejects(client.call('hang'),/Browser exited/);child.emit('exit',7,null);await failure;client.close();
});
test('total fixture deadline bounds commands even with larger per-command limit',async()=>{
 const {client}=await connect({deadline:Date.now()+30,commandTimeoutMs:30000});
 try{await assert.rejects(client.call('hang'),/timed out/);await assert.rejects(client.call('later'),/deadline/);}finally{client.close();}
});
test('DevTools discovery uses only port from fresh profile and validates same-port page target',async()=>{
 const child=new EventEmitter();child.exitCode=null;child.signalCode=null;const state=observeChild(child);let readPath,requested;
 const options={deadline:Date.now()+1000,read:async file=>{readPath=file;return '45678\n/devtools/browser/test';},fetchImpl:async url=>{requested=url;return {ok:true,json:async()=>[{type:'page',webSocketDebuggerUrl:'ws://127.0.0.1:45678/devtools/page/test'}]};}};
 assert.equal(await waitForDevTools(state,'fresh-profile',options),'ws://127.0.0.1:45678/devtools/page/test');
 assert.match(readPath,/fresh-profile.*DevToolsActivePort/);assert.equal(requested,'http://127.0.0.1:45678/json');
 await assert.rejects(waitForDevTools(state,'fresh', {...options,fetchImpl:async()=>({ok:true,json:async()=>[{type:'page',webSocketDebuggerUrl:'ws://127.0.0.1:9229/devtools/page/old'}]})}),/Invalid isolated/);
 child.emit('exit',1,null);await assert.rejects(waitForDevTools(state,'fresh',options),/Browser exited/);
});
test('discovery hung fetch and missing port have deadlines without a browser',async()=>{
 const state={check(){}};
 await assert.rejects(waitForDevTools(state,'fresh',{deadline:Date.now()+25,read:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});}}),/deadline/);
 await assert.rejects(waitForDevTools(state,'fresh',{deadline:Date.now()+25,read:async()=>'45678',fetchImpl:async()=>new Promise(()=>{})}),/timed out/);
});
test('cleanup handles already closed processes and waits for close after kill',async()=>{
 const child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.pid=undefined;
 const state=observeChild(child);let killed=false;child.kill=()=>{killed=true;child.emit('exit',null,'SIGKILL');setImmediate(()=>child.emit('close'));};
 await stopBrowser(child,state,{timeoutMs:100});assert.equal(killed,true);assert.equal(state.closed,true);
 child.kill=()=>assert.fail('already closed');await stopBrowser(child,state,{timeoutMs:20});
});
test('cleanup fails boundedly when process never closes instead of deleting its profile',async()=>{
 const child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.pid=undefined;child.kill=()=>{};
 await assert.rejects(stopBrowser(child,observeChild(child),{timeoutMs:20}),/preserving temporary profile/);
});
test('within observes late rejection after a deadline',async()=>{
 let reject;const pending=new Promise((_resolve,r)=>{reject=r;});await assert.rejects(within(pending,10,'test'),/timed out/);reject(Error('late'));
});

test('DevTools retries refused connection, server error and empty target during startup',async()=>{
 let calls=0;const state={check(){}};
 const target='ws://127.0.0.1:45678/devtools/page/fresh';
 const result=await waitForDevTools(state,'fresh',{deadline:Date.now()+1000,read:async()=>'45678',fetchImpl:async()=>{
  calls++;
  if(calls===1)throw Object.assign(Error('fetch failed'),{cause:{code:'ECONNREFUSED'}});
  if(calls===2)return {ok:false,status:503};
  if(calls===3)return {ok:true,json:async()=>[]};
  return {ok:true,json:async()=>[{type:'page',webSocketDebuggerUrl:target}]};
 }});
 assert.equal(result,target);assert.equal(calls,4);
});
test('DevTools retry remains bounded and never swallows child exit or invalid target',async()=>{
 const state={check(){}};
 await assert.rejects(waitForDevTools(state,'fresh',{deadline:Date.now()+70,read:async()=>'45678',fetchImpl:async()=>({ok:true,json:async()=>[]})}),/deadline/);
 let exited=false;
 await assert.rejects(waitForDevTools({check(){if(exited)throw Error('child exit');}},'fresh',{deadline:Date.now()+1000,read:async()=>'45678',fetchImpl:async()=>{exited=true;throw Object.assign(Error('refused'),{code:'ECONNREFUSED'});}}),/child exit/);
 for(const response of [{ok:false,status:403},{ok:true,json:async()=>{throw Error('bad JSON');}},{ok:true,json:async()=>[{type:'page',webSocketDebuggerUrl:'not a URL'}]}]){
  let calls=0;
  await assert.rejects(waitForDevTools(state,'fresh',{deadline:Date.now()+1000,read:async()=>'45678',fetchImpl:async()=>{calls++;return response;}}));
  assert.equal(calls,1);
 }
});
test('browser remains in outer timeout process group',()=>{
 assert.equal(browserSpawnOptions().detached,false);
});
