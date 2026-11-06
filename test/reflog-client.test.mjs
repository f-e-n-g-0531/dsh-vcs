import test from 'node:test';
import assert from 'node:assert/strict';
import {build,transformSync} from 'esbuild';
import {readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';

function frontendHarness(entry, initialProps, environment={}) {
 const modules=new Map(),instances=new Map(),ids=new WeakMap();let nextId=0,current,cursor=0,dirty=true,tree,props=initialProps,effects=[];
 const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const React={Fragment:Symbol('fragment'),createElement:(type,p,...children)=>({type,props:{...p,children}}),
  useState(initial){const owner=current,i=cursor++;if(!(i in owner.slots))owner.slots[i]=typeof initial==='function'?initial():initial;return [owner.slots[i],value=>{if(!owner.active)return;const next=typeof value==='function'?value(owner.slots[i]):value;if(!Object.is(next,owner.slots[i])){owner.slots[i]=next;dirty=true;}}];},
  useRef(initial){const i=cursor++;return current.slots[i]??(current.slots[i]={current:initial});},
  useMemo(fn,deps){const i=cursor++,old=current.slots[i];if(!old||!equal(old.deps,deps))current.slots[i]={deps,value:fn()};return current.slots[i].value;},
  useEffect(fn,deps){const owner=current,i=cursor++,old=owner.slots[i];if(!old||!equal(old.deps,deps))effects.push(()=>{old?.cleanup?.();owner.slots[i]={deps,cleanup:fn()};});},
  useSyncExternalStore(subscribe,snapshot){return snapshot();},
  Component:class {constructor(p){this.props=p;}},
 };
 const document={baseURI:'https://fixture.test/',visibilityState:'visible',head:{appendChild(){}},createElement:()=>({remove(){}})};
 const context={AbortController,URL,Set,Map,console,window:{addEventListener(){},removeEventListener(){}},document,setTimeout,clearTimeout,...environment};
 function load(path){
  path=resolve(path);if(modules.has(path))return modules.get(path).exports;
  if(path.endsWith('editor-loader.mjs'))return {loadEditor:async()=>{throw Error('memory-only editor unavailable');}};
  if(path.endsWith('HistoryViewer.jsx'))return {__esModule:true,default:()=>null};
  if(path.endsWith('.css'))return '';
  const source=readFileSync(path,'utf8');if(path.endsWith('.json'))return JSON.parse(source);
  const module={exports:{}};modules.set(path,module);
  const code=transformSync(source,{loader:path.endsWith('.jsx')?'jsx':'js',format:'cjs'}).code;
  vm.runInNewContext(code,{...context,module,exports:module.exports,require:name=>name==='react'?React:load(resolve(dirname(path),name))},{filename:path});return module.exports;
 }
 const exported=load(resolve(entry));
 const Root=exported.default||exported.createPage(initialProps.ctx,initialProps.options);
 function render(node,path,seen){
  if(node==null||typeof node!=='object')return node;
  if(Array.isArray(node))return node.map((n,i)=>render(n,path+'/'+i,seen));
  const {type,props:p}=node;if(typeof type!=='function')return {...node,props:{...p,children:render(p.children,path+'/children',seen)}};
  if(!ids.has(type))ids.set(type,++nextId);const address=path+':'+ids.get(type)+':'+(p.key??'');seen.add(address);
  let owner=instances.get(address);if(!owner){owner={slots:[],active:true};instances.set(address,owner);}
  current=owner;cursor=0;let output;
  if(type.prototype?.render){const instance=owner.instance??(owner.instance=new type(p));instance.props=p;output=instance.render();}
  else output=type(p);
  return {...node,output:render(output,address+'/output',seen)};
 }
 const disposeOwner=owner=>{owner.active=false;for(const slot of owner.slots)slot?.cleanup?.();};
 return {async flush(){for(let round=0;round<40;round++){if(dirty){dirty=false;effects=[];const seen=new Set();tree=render(React.createElement(Root,props),'root',seen);for(const [key,owner] of instances)if(!seen.has(key)){disposeOwner(owner);instances.delete(key);}for(const effect of effects)effect();}await Promise.resolve();await Promise.resolve();await Promise.resolve();}return tree;},
  update(next){props=next;dirty=true;},get tree(){return tree;},dispose(){for(const owner of instances.values())disposeOwner(owner);instances.clear();}};
}
function renderedNodes(node,out=[]){if(node==null||typeof node!=='object')return out;if(Array.isArray(node)){for(const child of node)renderedNodes(child,out);return out;}out.push(node);renderedNodes('output' in node?node.output:node.props?.children,out);return out;}
const nodeText=node=>node==null?'':Array.isArray(node)?node.map(nodeText).join(''):typeof node==='object'?nodeText('output'in node?node.output:node.props?.children):String(node);
const findNode=(h,predicate)=>renderedNodes(h.tree).find(predicate);
const button=(h,label)=>findNode(h,n=>n.type==='button'&&nodeText(n)===label);
const input=(h,label)=>findNode(h,n=>n.props?.['aria-label']===label&&['input','select'].includes(n.type));

function workspaceContext(rpc){return {locale:{bind:()=>key=>key,subscribe:()=>()=>{},getSnapshot:()=>0},connection:{rpc:{call:async(_channel,e,p,signal)=>({ok:true,value:await rpc(e,p,signal)})}},layout:{selectPanel(){}}};}

const id='a'.repeat(40),snapshot={entries:[{id,selector:'HEAD@{0}',message:'reset: moving to fixed',date:'2026-11-05T10:00:00Z'},{id,selector:'HEAD@{1}',message:'same commit again',date:'2026-11-04T10:00:00Z'}],truncated:true};
function fixture(handler=async()=>snapshot){
 const calls=[];let rediscoveries=0;
 const props={sessionId:'s',repositoryId:'r',t:k=>k,onRediscover(){rediscoveries++;},rpc:(e,p,signal)=>{calls.push({e,p,signal});if(e==='vcs/reflog')return handler(p,signal);if(e==='vcs/commit')return Promise.resolve({id,subject:'fixed details',author:'T',date:'now',parents:[],parent:null,changes:[]});if(e==='vcs/tree')return Promise.resolve({entries:[]});throw Error('Unexpected endpoint '+e);}};
 const h=frontendHarness('src/ReflogPanel.jsx',props);return {h,calls,props,get rediscoveries(){return rediscoveries;}};
}

test('single bounded snapshot shows selector, message, date and opens exact returned commit; duplicate OIDs remain separate entries',async()=>{
 const f=fixture();try{await f.h.flush();assert.equal(f.calls.length,1);assert.deepEqual(Object.keys(f.calls[0].p).sort(),['repositoryId','sessionId']);assert.ok(f.calls[0].signal instanceof AbortSignal);assert.match(nodeText(f.h.tree),/reflogScope/);assert.match(nodeText(f.h.tree),/reflogTruncated/);
 const rows=renderedNodes(f.h.tree).filter(n=>n.type==='button'&&nodeText(n).includes('HEAD@'));assert.equal(rows.length,2);assert.match(nodeText(rows[0]),/reset: moving to fixed.*2026-11-05/);rows[0].props.onClick();await f.h.flush();const commit=f.calls.find(c=>c.e==='vcs/commit');assert.equal(commit.p.commit,id);assert.match(nodeText(f.h.tree),/fixed details/);assert.ok(f.calls.every(c=>['vcs/reflog','vcs/commit','vcs/tree'].includes(c.e)));
 button(f.h,'refresh').props.onClick();await f.h.flush();assert.equal(f.calls.filter(c=>c.e==='vcs/reflog').length,2);assert.equal(nodeText(f.h.tree).includes('fixed details'),false);
 }finally{f.h.dispose();}
});

test('cancel aborts and suppresses late snapshot, retry errors and expiry rediscovery are read-only',async()=>{
 let finish,attempt=0;const f=fixture(()=>{attempt++;if(attempt===1)return new Promise(done=>{finish=done;});if(attempt===2)return Promise.reject(Error('read failed'));if(attempt===3)return Promise.reject(Object.assign(Error('expired'),{code:'vcs/rediscover-required'}));return Promise.resolve({entries:[],truncated:false});});
 try{await f.h.flush();button(f.h,'reflogCancel').props.onClick();await f.h.flush();assert.equal(f.calls[0].signal.aborted,true);finish(snapshot);await f.h.flush();assert.match(nodeText(f.h.tree),/reflogCancelled/);assert.equal(nodeText(f.h.tree).includes('HEAD@'),false);
 button(f.h,'retry').props.onClick();await f.h.flush();assert.match(nodeText(f.h.tree),/read failed/);button(f.h,'retry').props.onClick();await f.h.flush();assert.equal(f.rediscoveries,1);button(f.h,'retry').props.onClick();await f.h.flush();assert.match(nodeText(f.h.tree),/reflogEmpty/);assert.ok(f.calls.every(c=>c.e==='vcs/reflog'));
 }finally{f.h.dispose();}
});

test('repository/session changes and unmount abort requests and ignore late success and expiry errors',async()=>{
 let finish,fail;const f=fixture(p=>p.repositoryId==='r'?new Promise(done=>{finish=done;}):p.sessionId==='s'?new Promise((_,reject)=>{fail=reject;}):Promise.resolve({entries:[],truncated:false}));
 try{await f.h.flush();f.h.update({...f.props,repositoryId:'other'});await f.h.flush();assert.equal(f.calls[0].signal.aborted,true);finish(snapshot);await f.h.flush();assert.equal(nodeText(f.h.tree).includes('HEAD@'),false);f.h.update({...f.props,repositoryId:'other',sessionId:'next'});await f.h.flush();assert.equal(f.calls[1].signal.aborted,true);fail(Object.assign(Error('old expired'),{code:'vcs/rediscover-required'}));await f.h.flush();assert.equal(f.rediscoveries,0);assert.match(nodeText(f.h.tree),/reflogEmpty/);
 }finally{f.h.dispose();}assert.equal(f.calls.at(-1).signal.aborted,true);
});

test('invalid snapshots are rejected rather than silently hiding limits',async()=>{
 for(const response of [{entries:[],truncated:null},{entries:Array(201).fill(snapshot.entries[0]),truncated:false},{entries:[{id}],truncated:false}]){
 const f=fixture(async()=>response);try{await f.h.flush();assert.match(nodeText(f.h.tree),/reflogInvalid/);assert.ok(button(f.h,'retry'));}finally{f.h.dispose();}}
});

test('production Reflog toolbar is Git-only and exclusive, refresh reloads snapshot, repository/session changes clear details',async()=>{
 const calls=[];const rpc=async(e,p)=>{calls.push({e,p});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'},{id:'other',type:'git',relativePath:'other'},{id:'svn',type:'svn',relativePath:'svn'}]};if(e==='vcs/status')return {changes:[]};if(e==='vcs/reflog')return snapshot;if(e==='vcs/commit')return {id,subject:'fixed details',author:'T',date:'now',parents:[],parent:null,changes:[]};if(e==='vcs/tree')return {entries:[]};if(e==='vcs/stash-list')return {stashes:[]};throw Error('Unexpected '+e);};
 const ctx=workspaceContext(rpc),props={ctx,options:{},useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})};const h=frontendHarness('src/client.jsx',props);
 try{await h.flush();assert.equal(calls.some(c=>c.e==='vcs/reflog'),false);button(h,'reflog').props.onClick();await h.flush();assert.equal(button(h,'reflog').props['aria-pressed'],true);assert.equal(button(h,'stash').props['aria-pressed'],false);assert.equal(input(h,'gitMode').props.disabled,true);button(h,'refresh').props.onClick();await h.flush();assert.equal(calls.filter(c=>c.e==='vcs/reflog').length,2);
 findNode(h,n=>n.type==='button'&&nodeText(n).includes('HEAD@{0}')).props.onClick();await h.flush();assert.match(nodeText(h.tree),/fixed details/);input(h,'repositories').props.onChange({target:{value:'other'}});await h.flush();assert.equal(nodeText(h.tree).includes('fixed details'),false);assert.equal(calls.filter(c=>c.e==='vcs/reflog').at(-1).p.repositoryId,'other');
 button(h,'stash').props.onClick();await h.flush();assert.equal(button(h,'reflog').props['aria-pressed'],false);assert.equal(findNode(h,n=>n.type==='section'&&n.props['aria-label']==='reflogTitle'),undefined);input(h,'repositories').props.onChange({target:{value:'svn'}});await h.flush();assert.equal(button(h,'reflog'),undefined);
 }finally{h.dispose();}
});

test('Reflog source and browser fixture compile in memory; all labels have zh/en translations',async()=>{
 for(const entry of ['src/ReflogPanel.jsx','src/client.jsx','scripts/reflog-browser.jsx']){const result=await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'esm',external:['react','react-dom/client','react-dom'],loader:{'.css':'text'}});assert.ok(result.outputFiles[0].contents.length);}
 const locales=JSON.parse(await readFile('src/locales.json','utf8'));const source=await readFile('src/ReflogPanel.jsx','utf8');for(const [,key] of source.matchAll(/\bt\('([^']+)'\)/g))for(const lang of ['zh','en'])assert.equal(typeof locales[lang][key],'string',key);
});
