import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
import {button, findNode, nodeText, renderedNodes} from './frontend-harness.mjs';

// Reuse the shared lifecycle fixture, replacing only its two intentional editor
// stubs in memory. Shared fixture/source files and the running DSH stay untouched.
const source = readFileSync(new URL('./frontend-harness.mjs', import.meta.url), 'utf8')
 .replace("if(path.endsWith('editor-loader.mjs'))return {loadEditor:async()=>{throw Error('memory-only editor unavailable');}};", "if(path.endsWith('editor-loader.mjs'))return {loadEditor:environment.loadHistoryEditor};")
 .replace("if(path.endsWith('HistoryViewer.jsx'))return {__esModule:true,default:()=>null};", '');
const fixtureModule = {exports:{}};
vm.runInNewContext(transformSync(source,{format:'cjs'}).code, {module:fixtureModule,exports:fixtureModule.exports,require:createRequire(import.meta.url),AbortController,URL,console,setTimeout,clearTimeout});
const {frontendHarness} = fixtureModule.exports;
const comparison = {left:{text:'before'},right:{text:'first\nsecond\nthird'}};
const props = extra => ({comparison,identity:'immutable-file',t:key=>key,...extra});
function fixture(entry='src/HistoryViewer.jsx', initial=props()) {
 const loads=[], links=[];
 const document={baseURI:'https://fixture.test/',head:{appendChild(link){links.push(link);}},createElement(){return {removed:0,remove(){this.removed++;}};}};
 const h=frontendHarness(entry,initial,{document,loadHistoryEditor(url,{signal}){return new Promise((resolve,reject)=>loads.push({url,signal,resolve,reject}));}});
 return {h,loads,links};
}
function editorModule() {
 const calls={content:[],options:[],lines:[],disposed:0,created:0};
 return {calls,module:{createDiff(_node,options){calls.created++;calls.creationOptions=options;return {setContent:(...args)=>calls.content.push(args),options:value=>calls.options.push(value),revealLine:value=>calls.lines.push(value),dispose(){calls.disposed++;}};}}};
}
const fallback = h => findNode(h,n=>n.props?.className?.includes('vcs-text-comparison'));

test('explicit retry changes module URL, keeps fallback mounted, content and viewer settings',async()=>{
 const reports=[], f=fixture('src/HistoryViewer.jsx',props({initialOptions:{sideBySide:false,ignoreWhitespace:true,wrap:true},onOptionsChange:v=>reports.push(v)}));
 try {
  await f.h.flush();assert.equal(f.loads.length,1);assert.equal(button(f.h,'retry'),undefined);
  f.loads[0].reject(Error('asset failed'));await f.h.flush();
  const basic=fallback(f.h);assert.ok(basic);assert.match(nodeText(f.h.tree),/asset failed/);
  const retry=button(f.h,'retry');assert.ok(retry);
  retry.props.onClick();retry.props.onClick();await f.h.flush();
  assert.equal(f.loads.length,2);assert.equal(button(f.h,'retry'),undefined);assert.ok(fallback(f.h));
  const oldURL=new URL(f.loads[0].url),nextURL=new URL(f.loads[1].url);
  assert.equal(oldURL.searchParams.get('retry'),'0');assert.equal(nextURL.searchParams.get('retry'),'1');
  assert.equal(oldURL.searchParams.get('v'),nextURL.searchParams.get('v'));assert.equal(oldURL.pathname,nextURL.pathname);
  assert.equal(f.loads[0].signal.aborted,true);assert.equal(f.links[0].removed,1);
  const editor=editorModule();f.loads[1].resolve(editor.module);await f.h.flush();
  assert.equal(fallback(f.h),undefined);assert.equal(editor.calls.content[0][0],comparison);assert.equal(editor.calls.content[0][1],'immutable-file');
  assert.deepEqual({...editor.calls.options.at(-1)},{sideBySide:false,ignoreWhitespace:true,wrap:true,startLine:1});
  assert.equal(reports.length,0);assert.ok(button(f.h,'inline'));
  f.h.dispose();assert.equal(editor.calls.disposed,1);assert.ok(f.links.every(link=>link.removed===1));
 } finally {f.h.dispose();}
});

test('retry preserves single-file target and does not reread historical body',async()=>{
 const rpcCalls=[];
 const initial={sessionId:'s',repositoryId:'r',commit:'fixed',path:'file',line:2,t:key=>key,rpc:async(e,p)=>{rpcCalls.push({e,p});if(e==='vcs/tree-file')return {oid:'blob',text:'first\nsecond\nthird'};return {commits:[],nextOffset:null};}};
 const f=fixture('src/HistoricalFile.jsx',initial);
 try {
  await f.h.flush();f.loads[0].reject(Error('module failed'));await f.h.flush();
  assert.equal(findNode(f.h,n=>n.props?.['data-target']===true).props['data-line'],2);
  const count=rpcCalls.length;button(f.h,'retry').props.onClick();await f.h.flush();assert.equal(rpcCalls.length,count);
  const editor=editorModule();f.loads[1].resolve(editor.module);await f.h.flush();
  assert.deepEqual(editor.calls.lines,[2]);assert.equal(editor.calls.content[0][0].right.text,'first\nsecond\nthird');
  assert.equal(rpcCalls.filter(call=>call.e==='vcs/tree-file').length,1);
 } finally {f.h.dispose();}
});

test('content failure can retry repeatedly without resetting options or accepting old clicks',async()=>{
 const f=fixture();
 try {
  await f.h.flush();const first=editorModule();f.loads[0].resolve(first.module);await f.h.flush();
  button(f.h,'side').props.onClick();await f.h.flush();
  const checks=renderedNodes(f.h.tree).filter(n=>n.type==='input');
  for(const check of checks)check.props.onChange({target:{checked:true}});await f.h.flush();
  f.h.update(props({identity:'replacement'}));await f.h.flush();
  f.loads[1].reject(Error('load failed'));await f.h.flush();const oldClick=button(f.h,'retry').props.onClick;
  oldClick();await f.h.flush();const broken=editorModule();broken.module.createDiff=()=>({setContent(){throw Error('content failed');},dispose(){broken.calls.disposed++;}});
  f.loads[2].resolve(broken.module);await f.h.flush();assert.match(nodeText(f.h.tree),/content failed/);assert.equal(broken.calls.disposed,1);
  oldClick();await f.h.flush();assert.equal(f.loads.length,3);
  button(f.h,'retry').props.onClick();await f.h.flush();assert.equal(new URL(f.loads[3].url).searchParams.get('retry'),'2');
  const recovered=editorModule();f.loads[3].resolve(recovered.module);await f.h.flush();
  assert.deepEqual({...recovered.calls.options.at(-1)},{sideBySide:false,ignoreWhitespace:true,wrap:true,startLine:1});
  assert.equal(first.calls.disposed,1);assert.equal(recovered.calls.content[0][1],'replacement');
 }finally{f.h.dispose();}
});

test('late failure from replaced selection cannot overwrite a successful retry',async()=>{
 const f=fixture();
 try {
  await f.h.flush();f.h.update(props({identity:'new-selection'}));await f.h.flush();
  f.loads[1].reject(Error('new failure'));await f.h.flush();button(f.h,'retry').props.onClick();await f.h.flush();
  const editor=editorModule();f.loads[2].resolve(editor.module);await f.h.flush();
  f.loads[0].reject(Error('late old failure'));await f.h.flush();
  assert.equal(button(f.h,'retry'),undefined);assert.doesNotMatch(nodeText(f.h.tree),/late old failure/);assert.equal(editor.calls.disposed,0);
 } finally {f.h.dispose();}
});

for (const outcome of ['resolve','reject']) test('cancel during retry ignores late '+outcome+' and retained clicks',async()=>{
 const f=fixture();
 try {
  await f.h.flush();f.loads[0].reject(Error('failed'));await f.h.flush();
  const stale=button(f.h,'retry').props.onClick;stale();await f.h.flush();
  button(f.h,'historyBasic').props.onClick();await f.h.flush();assert.equal(f.loads[1].signal.aborted,true);
  stale();const editor=editorModule();if(outcome==='resolve')f.loads[1].resolve(editor.module);else f.loads[1].reject(Error('late failure'));
  await f.h.flush();assert.equal(f.loads.length,2);assert.equal(editor.calls.created,0);assert.ok(fallback(f.h));assert.equal(button(f.h,'retry'),undefined);
  assert.ok(button(f.h,'historyAdvanced'));assert.ok(f.links.every(link=>link.removed===1));
 } finally {f.h.dispose();}
});

test('unmount during retry cannot create an editor or revive loading',async()=>{
 const f=fixture();await f.h.flush();f.loads[0].reject(Error('failed'));await f.h.flush();
 const stale=button(f.h,'retry').props.onClick;stale();await f.h.flush();f.h.dispose();stale();
 const editor=editorModule();f.loads[1].resolve(editor.module);await Promise.resolve();await Promise.resolve();
 assert.equal(editor.calls.created,0);assert.equal(f.loads.length,2);assert.equal(f.loads[1].signal.aborted,true);assert.ok(f.links.every(link=>link.removed===1));
});

test('basic-only initial view never starts editor or offers retry',async()=>{
 const f=fixture('src/HistoryViewer.jsx',props({initialOptions:{enabled:false}}));
 try {await f.h.flush();assert.equal(f.loads.length,0);assert.ok(fallback(f.h));assert.equal(button(f.h,'retry'),undefined);assert.equal(renderedNodes(f.h.tree).filter(n=>n.type==='button'&&nodeText(n)==='historyAdvanced').length,1);}finally{f.h.dispose();}
});
