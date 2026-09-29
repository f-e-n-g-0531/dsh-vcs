import test from 'node:test';
import assert from 'node:assert/strict';
import {startHistoryEditor} from '../src/history-editor.mjs';
test('historical editor initializes exact content and releases once',async()=>{
 const data={left:{text:'a'},right:{text:'b'}},node={},calls=[];
 const editor={setContent:(...args)=>calls.push(args),dispose:()=>calls.push('dispose')};
 let signal;
 const task=startHistoryEditor({node,comparison:data,key:'commit-parent-file',load:async s=>{signal=s;return {createDiff:n=>{assert.equal(n,node);return editor;}};},onReady:e=>assert.equal(e,editor)});
 await task.done;assert.deepEqual(calls,[[data,'commit-parent-file']]);
 task.dispose();task.dispose();assert.equal(signal.aborted,true);assert.deepEqual(calls.at(-1),'dispose');assert.equal(calls.length,2);
});
test('late editor module never creates an instance after unmount',async()=>{
 let resolve,signal;const calls=[];
 const task=startHistoryEditor({load:s=>{signal=s;return new Promise(r=>{resolve=r;});},onReady:()=>calls.push('ready'),onError:()=>calls.push('error')});
 await Promise.resolve();task.dispose();assert.equal(signal.aborted,true);
 resolve({createDiff:()=>calls.push('create')});await task.done;assert.deepEqual(calls,[]);
});
test('content initialization failure disposes editor and reports fallback',async()=>{
 let released=0,reported;const failure=Error('model failed');
 const task=startHistoryEditor({load:async()=>({createDiff:()=>({setContent(){throw failure;},dispose(){released++;}})}),onError:e=>{reported=e;}});
 await task.done;task.dispose();assert.equal(released,1);assert.equal(reported,failure);
});
test('cancel before load prevents resource access and load failures report once',async()=>{
 let loads=0,errors=0;
 const early=startHistoryEditor({load:()=>{loads++;},onError:()=>errors++});early.dispose();await early.done;assert.equal(loads,0);assert.equal(errors,0);
 const failure=startHistoryEditor({load:async()=>{throw Error('HTTP 401');},onError:()=>errors++});await failure.done;failure.dispose();assert.equal(errors,1);
});
