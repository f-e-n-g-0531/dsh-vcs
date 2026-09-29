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
test('environment cleanup preserves external replacements and original absence',()=>{
 const host={},acquire=createEnvironmentOwner(host,()=>({terminate(){}}));
 acquire()();assert.equal(Object.hasOwn(host,'MonacoEnvironment'),false);
 const release=acquire(),external={};host.MonacoEnvironment=external;release();assert.equal(host.MonacoEnvironment,external);
});
