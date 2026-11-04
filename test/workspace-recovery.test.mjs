import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {transformSync} from 'esbuild';
const source=readFileSync('test/frontend-harness.mjs','utf8').replace("if(path.endsWith('editor-loader.mjs'))return {loadEditor:async()=>{throw Error('memory-only editor unavailable');}};","if(path.endsWith('editor-loader.mjs'))return {loadEditor:environment.loadEditor||(async()=>{throw Error('memory-only editor unavailable');})};");
const module={exports:{}};vm.runInNewContext(transformSync(source,{format:'cjs'}).code,{module,exports:module.exports,require:createRequire(import.meta.url),AbortController,URL,console,setTimeout,clearTimeout});
const {frontendHarness,findNode,nodeText,renderedNodes,input,button}=module.exports;
const comparison={path:'f.txt',left:{text:'old',label:'HEAD'},right:{text:'new',label:'Working tree'}};
function fixture(compare,environment={}){
 const calls=[];const rpc=async(e,p,signal)=>{calls.push({e,p,signal});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.',branch:'main'}]};if(e==='vcs/status')return {changes:[{id:'f',path:'f.txt',status:'modified'}]};if(e==='vcs/compare')return compare(p,signal);throw Error('unexpected '+e);};
 const ctx={locale:{bind:()=>k=>k,subscribe:()=>()=>{},getSnapshot:()=>0},connection:{rpc:{call:async(_channel,e,p,signal)=>{try{return {ok:true,value:await rpc(e,p,signal)};}catch(error){return {ok:false,error:{code:error.code,message:error.message}};}}}},layout:{selectPanel(){}}};
 const props={ctx,useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})};
 const h=frontendHarness('src/client.jsx',props,environment);return {h,calls,props};
}
async function select(f){await f.h.flush();const row=findNode(f.h,n=>n.type==='button'&&n.props.className?.includes('vcs-file'));assert.ok(row);row.props.onClick();await f.h.flush();}
const compares=f=>f.calls.filter(c=>c.e==='vcs/compare');
test('ordinary comparison retry preserves exact selection and filters without discovery or status refresh',async()=>{
 let count=0;const f=fixture(async()=>{if(++count===1)throw Error('temporary compare failure');return comparison;});
 try{await select(f);assert.match(nodeText(f.h.tree),/temporary compare failure/);const initial=f.calls.length;const retry=renderedNodes(f.h.tree).filter(n=>n.type==='button'&&nodeText(n)==='retry').at(-1);assert.ok(retry);retry.props.onClick();await f.h.flush();assert.equal(f.calls.length,initial+1);assert.equal(compares(f).length,2);assert.equal(JSON.stringify(compares(f)[0].p),JSON.stringify(compares(f)[1].p));assert.equal(f.calls.filter(c=>c.e==='vcs/repositories').length,1);assert.equal(f.calls.filter(c=>c.e==='vcs/status').length,1);assert.match(nodeText(f.h.tree),/Working tree/);assert.doesNotMatch(nodeText(f.h.tree),/temporary compare failure/);}finally{f.h.dispose();}
});
test('comparison identity expiry still rediscovers rather than retrying the stale selection',async()=>{
 const f=fixture(async()=>{throw Object.assign(Error('expired'),{code:'vcs/rediscover-required'});});try{await select(f);assert.equal(compares(f).length,1);assert.equal(f.calls.filter(c=>c.e==='vcs/repositories').length,2);assert.equal(f.calls.filter(c=>c.e==='vcs/status').length,2);}finally{f.h.dispose();}
});
test('workspace setContent failure is local and editor retry does not reload the comparison',async()=>{
 let created=0,disposed=0;const urls=[];const f=fixture(async()=>comparison,{loadEditor:async url=>{urls.push(url);const id=++created;return {createDiff:()=>({setContent(value){if(id===1&&value.path)throw Error('render failed');},options(){},dispose(){disposed++;}})};}});
 try{await select(f);assert.match(nodeText(f.h.tree),/render failed/);assert.equal(disposed,1);const calls=f.calls.length;button(f.h,'retry').props.onClick();await f.h.flush();assert.equal(f.calls.length,calls);assert.equal(compares(f).length,1);assert.equal(created,2);assert.ok(urls[0].endsWith('retry=0'));assert.ok(urls[1].endsWith('retry=1'));assert.doesNotMatch(nodeText(f.h.tree),/render failed/);}finally{f.h.dispose();}assert.equal(disposed,2);
});
test('workspace cleanup removes CSS even when editor disposal throws',async()=>{
 let links=0,disposed=0;const document={baseURI:'https://fixture.test/',visibilityState:'visible',head:{appendChild(){links++;}},createElement:()=>({remove(){links--;}})};const f=fixture(async()=>comparison,{document,loadEditor:async()=>({createDiff:()=>({setContent(){},options(){},dispose(){disposed++;throw Error('dispose failure');}})})});
 await f.h.flush();assert.equal(links,1);assert.throws(()=>f.h.dispose(),/dispose failure/);assert.equal(disposed,1);assert.equal(links,0);
});
