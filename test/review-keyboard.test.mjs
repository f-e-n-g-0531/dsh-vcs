import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewShortcut} from '../src/review-keyboard.mjs';
const target={closest:()=>null};
const root={contains:t=>t===target};
const event={target,key:'f',ctrlKey:true};
test('search is handled only inside the owning panel',()=>{
 assert.equal(reviewShortcut(event,root,null,false),'search');
 assert.equal(reviewShortcut(event,{contains:()=>false},null,false),null);
 assert.equal(reviewShortcut(event,null,null,false),null);
});
test('honors composition, handled events and conflicting modifiers',()=>{
 for(const patch of [{isComposing:true},{defaultPrevented:true},{altKey:true},{shiftKey:true}])assert.equal(reviewShortcut({...event,...patch},root,null,false),null);
});
test('does not steal input or Monaco shortcuts',()=>{
 for(const t of [{isContentEditable:true,closest:()=>null},{closest:()=>({})}])assert.equal(reviewShortcut({...event,target:t},{contains:()=>true},null,false),null);
});
test('search input supports find and Escape but not adjacent navigation',()=>{
 const input={closest:s=>s==='.monaco-editor'||s==='.vcs-history'?null:{}};
 const container={contains:()=>true};
 assert.equal(reviewShortcut({...event,target:input},container,input,true),'search');
 assert.equal(reviewShortcut({target:input,key:'Escape'},container,input,true),'clear');
 assert.equal(reviewShortcut({target:input,key:'Escape'},container,input,false),null);
 assert.equal(reviewShortcut({target:input,key:'ArrowRight',altKey:true},container,input,true),null);
});
test('history content does not trigger workspace file search or navigation',()=>{
 const historyTarget={closest:selector=>selector==='.vcs-history'?{}:null};
 for(const patch of [{key:'f',ctrlKey:true},{key:'f',metaKey:true},{key:'ArrowLeft',altKey:true},{key:'ArrowRight',altKey:true}]){
  assert.equal(reviewShortcut({target:historyTarget,...patch},{contains:()=>true},null,false),null);
 }
});
test('Alt arrows navigate from noneditable panel content',()=>{
 for(const [key,action] of [['ArrowLeft','previous'],['ArrowRight','next']])assert.equal(reviewShortcut({target,key,altKey:true},root,null,false),action);
 assert.equal(reviewShortcut({target,key:'ArrowRight'},root,null,false),null);
});
