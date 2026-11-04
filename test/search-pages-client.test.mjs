import test from 'node:test';
import assert from 'node:assert/strict';
import {frontendHarness,renderedNodes,nodeText,findNode,button,input} from './frontend-harness.mjs';
const A='a'.repeat(40),B='b'.repeat(40);
function fixture(handler){
 const calls=[];let rediscover=0;
 const props={sessionId:'s',repositoryId:'r',t:k=>k,onRediscover(){rediscover++;},rpc(e,p,signal){calls.push({e,p,signal});return handler(e,p,signal);}};
 const h=frontendHarness('src/GrepPanel.jsx',props);
 return {h,calls,props,get rediscover(){return rediscover;}};
}
async function query(f,value='needle'){
 input(f.h,'grepQuery').props.onChange({target:{value}});await f.h.flush();
 findNode(f.h,n=>n.type==='form').props.onSubmit({preventDefault(){}});await f.h.flush();
}
const page=(rows=[],rest={})=>({snapshot:A,matches:rows,complete:false,nextCursor:null,reason:null,...rest});
const hit=(line=2500)=>({path:'a.txt',line,text:'needle'});
test('search pages bind original query and snapshot; empty pages continue, previous replays only a bounded descriptor',async()=>{
 const f=fixture(async(e,p)=>{assert.equal(e,'vcs/grep');return p.cursor==='one'?page([hit()],{complete:true}):page([],{nextCursor:'one',reason:'scan-budget'});});
 try{await f.h.flush();await query(f);assert.ok(nodeText(f.h.tree).includes('grepEmptyPage'));assert.ok(button(f.h,'grepNextPage'));
  input(f.h,'grepQuery').props.onChange({target:{value:'not-submitted'}});await f.h.flush();
  button(f.h,'grepNextPage').props.onClick();await f.h.flush();
  assert.deepEqual({...f.calls.at(-1).p},{sessionId:'s',repositoryId:'r',query:'needle',commit:A,cursor:'one'});
  assert.ok(nodeText(f.h.tree).includes('grepComplete'));assert.equal(button(f.h,'grepNextPage'),undefined);
  button(f.h,'grepPreviousPage').props.onClick();await f.h.flush();
  assert.equal(f.calls.at(-1).p.commit,A);assert.equal(f.calls.at(-1).p.cursor,undefined);
 }finally{f.h.dispose();}
});
test('failed continuation retries the same snapshot and cursor without following HEAD',async()=>{
 let failed=false;
 const f=fixture(async(e,p)=>{if(!p.cursor)return page([hit(1)],{nextCursor:'next'});if(!failed){failed=true;throw Error('temporary');}return page([hit(2)],{complete:true});});
 try{await f.h.flush();await query(f);button(f.h,'grepNextPage').props.onClick();await f.h.flush();assert.ok(button(f.h,'retry'));
  button(f.h,'retry').props.onClick();await f.h.flush();assert.equal(f.calls.at(-1).p.cursor,'next');assert.equal(f.calls.at(-1).p.commit,A);assert.ok(button(f.h,'a.txt:2'));
 }finally{f.h.dispose();}
});
test('search navigation restores viewer settings and original result without another grep',async()=>{
 const f=fixture(async(e,p)=>e==='vcs/grep'?page([hit()],{complete:true}):{text:'needle',oid:'c'.repeat(40)});
 try{await f.h.flush();await query(f);button(f.h,'a.txt:2500').props.onClick();await f.h.flush();
  let preview=findNode(f.h,n=>typeof n.type==='function'&&n.props?.commit===A&&n.props?.onViewerChange);
  preview.props.onViewerChange({enabled:false,wrap:true});await f.h.flush();
  preview=findNode(f.h,n=>typeof n.type==='function'&&n.props?.commit===A&&n.props?.onViewerChange);
  preview.props.onSelectCommit(B,'old.txt',{line:12});await f.h.flush();
  button(f.h,'historyBack').props.onClick();await f.h.flush();
  preview=findNode(f.h,n=>typeof n.type==='function'&&n.props?.commit===A&&n.props?.onViewerChange);
  assert.equal(preview.props.initialViewer.enabled,false);assert.equal(preview.props.initialViewer.wrap,true);assert.equal(preview.props.line,2500);
  button(f.h,'historyBack').props.onClick();await f.h.flush();assert.ok(button(f.h,'a.txt:2500'));assert.equal(f.calls.filter(c=>c.e==='vcs/grep').length,1);
 }finally{f.h.dispose();}
});
test('late search is aborted and ignored across Session scope changes',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));
 try{await f.h.flush();await query(f);const old=f.calls[0];f.h.update({...f.props,sessionId:'other'});await f.h.flush();assert.equal(old.signal.aborted,true);
  resolve(page([{path:'STALE',line:1,text:'old'}],{complete:true}));await f.h.flush();assert.equal(nodeText(f.h.tree).includes('STALE'),false);assert.equal(input(f.h,'grepQuery').props.value,'');
 }finally{f.h.dispose();}
});
test('changed continuation snapshot is rejected and incomplete final result stays explicit',async()=>{
 const f=fixture(async(e,p)=>p.cursor?page([hit()],{snapshot:B,complete:true}):page([hit()],{nextCursor:'bad'}));
 try{await f.h.flush();await query(f);button(f.h,'grepNextPage').props.onClick();await f.h.flush();assert.ok(nodeText(f.h.tree).includes('grepInvalid'));}finally{f.h.dispose();}
 const partial=fixture(async()=>page([],{reason:'file-limit',warnings:['File skipped']}));
 try{await partial.h.flush();await query(partial);assert.ok(nodeText(partial.h.tree).includes('grepPartial'));assert.ok(nodeText(partial.h.tree).includes('File skipped'));assert.equal(button(partial.h,'grepNextPage'),undefined);}finally{partial.h.dispose();}
});
