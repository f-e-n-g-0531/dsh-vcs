import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnvironmentOwner} from '../src/editor-environment.mjs';
for(const order of [[0,1],[1,0]])test('worker environment survives editor disposal order '+order,()=>{
 const previous={getWorker:()=> 'foreign'},host={MonacoEnvironment:previous};let terminated=0;
 const acquire=createEnvironmentOwner(host,()=>({terminate(){terminated++;}}));
 const releases=[acquire(),acquire()],env=host.MonacoEnvironment;
 env.getWorker('','editorWorkerService');assert.equal(env.getWorker('','typescript'),'foreign');
 releases[order[0]]();assert.equal(terminated,0);assert.equal(host.MonacoEnvironment,env);
 releases[order[1]]();assert.equal(terminated,1);assert.equal(host.MonacoEnvironment,previous);
 releases[0]();releases[1]();assert.equal(terminated,1);
});
for(const order of [[0,1],[1,0]])test('cache-busted module owners share workers '+order,async()=>{
 const other=await import('../src/editor-environment.mjs?retry='+order.join(''));
 const host={},factory=()=>({terminate(){terminated++;}});let terminated=0;
 const a=createEnvironmentOwner(host,factory),b=other.createEnvironmentOwner(host,factory);
 const releases=[a(),b()],env=host.MonacoEnvironment;
 env.getWorker('','editorWorkerService');releases[order[0]]();
 assert.equal(terminated,0);assert.equal(host.MonacoEnvironment,env);
 env.getWorker('','editorWorkerService');releases[order[1]]();
 assert.equal(terminated,2);assert.equal(Object.hasOwn(host,'MonacoEnvironment'),false);
 assert.equal(Object.getOwnPropertySymbols(host).length,0);
 const again=b();assert.notEqual(host.MonacoEnvironment,env);again();
});
test('released environment rejects late allocations and does not terminate foreign workers',()=>{
 let created=0,foreignTerminated=0;
 const foreign={terminate(){foreignTerminated++;}},previous={getWorker(){return foreign;}},host={MonacoEnvironment:previous};
 const release=createEnvironmentOwner(host,()=>{created++;return {terminate(){throw Error('cleanup failure');}};})();
 const env=host.MonacoEnvironment;
 assert.equal(env.getWorker('','typescript'),foreign);env.getWorker('','editorWorkerService');release();
 assert.throws(()=>env.getWorker('','editorWorkerService'),/released/);
 assert.equal(created,1);assert.equal(foreignTerminated,0);assert.equal(host.MonacoEnvironment,previous);
 assert.equal(Object.getOwnPropertySymbols(host).length,0);
});
test('environment cleanup preserves external replacements and original absence',()=>{
 const host={},acquire=createEnvironmentOwner(host,()=>({terminate(){}}));
 acquire()();assert.equal(Object.hasOwn(host,'MonacoEnvironment'),false);
 const release=acquire(),external={};host.MonacoEnvironment=external;release();assert.equal(host.MonacoEnvironment,external);
});
