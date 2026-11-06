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


const A={name:'main',ref:'refs/heads/main',commit:'a'.repeat(40)},B={name:'feature/中文',ref:'refs/heads/feature/中文',commit:'b'.repeat(40)};
function fixture(overrides={},environment={}){
 const calls=[];let refreshes=0;
 const handlers={
  'vcs/branches':async()=>({current:A,branches:[A,B]}),
  'vcs/branch-switch-prepare':async()=>({token:'c'.repeat(64),expiresAt:Date.now()+59000,current:A,target:B}),
  'vcs/branch-switch-confirm':async()=>({current:B}),...overrides,
 };
 const props={sessionId:'s',repositoryId:'r',t:k=>k,onSwitched:()=>{refreshes++;},onRediscover(){},rpc:(e,p,signal)=>{calls.push({e,p,signal});return handlers[e](p,signal);}};
 const h=frontendHarness('src/BranchSwitcher.jsx',props,environment);
 return {h,calls,props,get refreshes(){return refreshes;}};
}
async function preview(f){button(f.h,'branchSwitcher').props.onClick();await f.h.flush();input(f.h,'branchTarget').props.onChange({target:{value:B.name}});await f.h.flush();button(f.h,'branchPrepare').props.onClick();await f.h.flush();}

test('two-stage branch preview uses exact local name; cancel never writes; confirm sends only one token',async()=>{
 const f=fixture();try{await f.h.flush();assert.equal(f.calls.length,0);await preview(f);assert.deepEqual(f.calls.map(c=>c.e),['vcs/branches','vcs/branch-switch-prepare']);assert.equal(f.calls[1].p.branch,B.name);assert.ok(nodeText(f.h.tree).includes(A.commit));assert.ok(nodeText(f.h.tree).includes(B.commit));assert.equal(nodeText(f.h.tree).includes('c'.repeat(64)),false);
  button(f.h,'branchCancel').props.onClick();await f.h.flush();assert.equal(f.calls.length,2);assert.equal(button(f.h,'branchConfirm'),undefined);
  button(f.h,'branchPrepare').props.onClick();await f.h.flush();const confirm=button(f.h,'branchConfirm');const one=confirm.props.onClick(),two=confirm.props.onClick();await Promise.all([one,two]);await f.h.flush();const writes=f.calls.filter(c=>c.e==='vcs/branch-switch-confirm');assert.equal(writes.length,1);assert.deepEqual(Object.keys(writes[0].p).sort(),['repositoryId','sessionId','token']);assert.equal(f.refreshes,1);
 }finally{f.h.dispose();}
});

test('dirty prepare is read-only and discards the preview without clearing workspace content',async()=>{
 const f=fixture({'vcs/branch-switch-prepare':async()=>{throw Object.assign(Error('Dirty working tree: preserve content'),{code:'vcs/branch-dirty'});}});
 try{await f.h.flush();await preview(f);assert.match(nodeText(f.h.tree),/Dirty working tree/);assert.equal(button(f.h,'branchConfirm'),undefined);assert.equal(f.refreshes,0);assert.equal(f.calls.some(c=>c.e==='vcs/branch-switch-confirm'),false);assert.ok(button(f.h,'branchRead'));}finally{f.h.dispose();}
});

test('any confirm rejection is unknown; no retry or automatic refresh until explicit recovery',async()=>{
 for(const code of ['vcs/branch-outcome-unknown','vcs/branch-confirmation-invalid','vcs/busy','vcs/rediscover-required',undefined]){
  const f=fixture({'vcs/branch-switch-confirm':async()=>{throw Object.assign(Error('connection or confirmation failure'),{code});}});
  try{await f.h.flush();await preview(f);const confirm=button(f.h,'branchConfirm');await confirm.props.onClick();await f.h.flush();assert.equal(f.refreshes,0);assert.ok(nodeText(f.h.tree).includes('branchUnknown'));assert.equal(button(f.h,'branchConfirm'),undefined);assert.equal(button(f.h,'branchRead'),undefined);await confirm.props.onClick();assert.equal(f.calls.filter(c=>c.e==='vcs/branch-switch-confirm').length,1);button(f.h,'branchRecover').props.onClick();assert.equal(f.refreshes,1);}finally{f.h.dispose();}
 }
});

test('expired prepared confirmation cannot write even through a retained click handler',async()=>{
 let now=Date.now();class Clock extends Date{static now(){return now;}}const prepared={token:'d'.repeat(64),expiresAt:now+59000,current:A,target:B};const f=fixture({'vcs/branch-switch-prepare':async()=>prepared},{Date:Clock});
 try{await f.h.flush();await preview(f);const confirm=button(f.h,'branchConfirm');now+=61001;await confirm.props.onClick();await f.h.flush();assert.equal(f.calls.some(c=>c.e==='vcs/branch-switch-confirm'),false);assert.ok(nodeText(f.h.tree).includes('branchExpired'));assert.equal(button(f.h,'branchConfirm'),undefined);}finally{f.h.dispose();}
});

test('scope changes abort pending preview and discard old tokens and late success callbacks',async()=>{
 let resolve;const f=fixture({'vcs/branch-switch-prepare':()=>new Promise(done=>{resolve=done;})});
 try{await f.h.flush();await preview(f);const pending=f.calls.at(-1);f.h.update({...f.props,sessionId:'next',repositoryId:'other'});await f.h.flush();assert.equal(pending.signal.aborted,true);resolve({token:'e'.repeat(64),expiresAt:Date.now()+59000,current:A,target:B});await f.h.flush();assert.equal(button(f.h,'branchConfirm'),undefined);assert.equal(f.calls.length,2);assert.equal(f.refreshes,0);}finally{f.h.dispose();}
 let finish;const g=fixture({'vcs/branch-switch-confirm':()=>new Promise(done=>{finish=done;})});
 try{await g.h.flush();await preview(g);const click=button(g.h,'branchConfirm').props.onClick();await g.h.flush();assert.equal(button(g.h,'branchSwitcher').props.disabled,true);g.h.update({...g.props,repositoryId:'new-repo'});await g.h.flush();assert.equal(g.calls.at(-1).signal.aborted,true);finish({current:B});await click;await g.h.flush();assert.equal(g.refreshes,0);assert.equal(g.calls.filter(c=>c.e==='vcs/branch-switch-confirm').length,1);}finally{g.h.dispose();}
});

test('list errors and mismatched confirmation responses never appear as successful writes',async()=>{
 const f=fixture({'vcs/branches':async()=>{throw Error('Detached HEAD is unsupported');}});try{await f.h.flush();button(f.h,'branchSwitcher').props.onClick();await f.h.flush();assert.match(nodeText(f.h.tree),/Detached HEAD/);assert.equal(input(f.h,'branchTarget'),undefined);assert.equal(f.refreshes,0);}finally{f.h.dispose();}
 const g=fixture({'vcs/branch-switch-confirm':async()=>({current:A})});try{await g.h.flush();await preview(g);await button(g.h,'branchConfirm').props.onClick();await g.h.flush();assert.match(nodeText(g.h.tree),/branchUnknown/);assert.equal(g.refreshes,0);}finally{g.h.dispose();}
});

test('production switch success clears selection and re-discovers status/history; SVN has no switch entry',async()=>{
 let switched=false;const calls=[];
 const rpc=async(e,p)=>{calls.push({e,p});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.',branch:switched?B.name:A.name},{id:'svn',type:'svn',relativePath:'svn'}]};if(e==='vcs/status')return {changes:[{id:'f',path:'f',status:'modified'}]};if(e==='vcs/history')return {snapshot:switched?B.commit:A.commit,commits:[],nextOffset:null};if(e==='vcs/branches')return {current:A,branches:[A,B]};if(e==='vcs/branch-switch-prepare')return {token:'f'.repeat(64),expiresAt:Date.now()+59000,current:A,target:B};if(e==='vcs/branch-switch-confirm'){switched=true;return {current:B};}throw Error('unexpected '+e);};
 const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),options:{initialView:'history'},useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})});
 try{await h.flush();assert.ok(nodeText(h.tree).includes('reviewWithBranchSwitch'));await preview({h});await button(h,'branchConfirm').props.onClick();await h.flush();assert.equal(calls.filter(c=>c.e==='vcs/repositories').length,2);assert.equal(calls.filter(c=>c.e==='vcs/status').length,2);assert.equal(calls.filter(c=>c.e==='vcs/history').length,2);input(h,'repositories').props.onChange({target:{value:'svn'}});await h.flush();assert.equal(button(h,'branchSwitcher'),undefined);assert.ok(nodeText(h.tree).includes('readonly'));}finally{h.dispose();}
});

test('switch UI, production client and dedicated browser scenario compile in memory with bilingual labels',async()=>{
 for(const entry of ['src/BranchSwitcher.jsx','src/client.jsx','scripts/branch-switch-browser.jsx']){const result=await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'esm',external:['react','react-dom/client','react-dom'],loader:{'.css':'text'}});assert.ok(result.outputFiles[0].contents.length);}
 const locales=JSON.parse(await readFile('src/locales.json','utf8'));const source=await readFile('src/BranchSwitcher.jsx','utf8');for(const [,key] of source.matchAll(/\bt\('([^']+)'\)/g))for(const lang of ['zh','en'])assert.equal(typeof locales[lang][key],'string',key);
});

test('expiry timer removes confirmation and closing or changing scope clears the timer',async()=>{
 const timers=new Map();let id=0;
 const f=fixture({}, {setTimeout:(fn,delay)=>{const key=++id;timers.set(key,{fn,delay});return key;},clearTimeout:key=>timers.delete(key)});
 try{await f.h.flush();await preview(f);assert.equal(timers.size,1);assert.ok([...timers.values()][0].delay>0);[...timers.values()][0].fn();await f.h.flush();assert.equal(button(f.h,'branchConfirm'),undefined);assert.match(nodeText(f.h.tree),/branchExpired/);assert.equal(timers.size,0);
  button(f.h,'branchPrepare').props.onClick();await f.h.flush();const stale=button(f.h,'branchConfirm');assert.equal(timers.size,1);f.h.update({...f.props,repositoryId:'other'});await f.h.flush();assert.equal(timers.size,0);await stale.props.onClick();assert.equal(f.calls.filter(c=>c.e==='vcs/branch-switch-confirm').length,0);
 }finally{f.h.dispose();}
});
