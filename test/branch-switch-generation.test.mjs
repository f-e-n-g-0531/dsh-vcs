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

// Retained handlers are invoked only in this memory harness, not the browser scenario.
const C={name:'other',ref:'refs/heads/other',commit:'d'.repeat(40)};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const list=()=>({current:A,branches:[A,B,C]});
const result=(target=B,token='c')=>({current:A,target,token:token.repeat(64),expiresAt:Date.now()+59000});
const count=(f,e)=>f.calls.filter(c=>c.e===e).length;
async function open(f){await f.h.flush();await button(f.h,'branchSwitcher').props.onClick();await f.h.flush();}
async function select(f,value){input(f.h,'branchTarget').props.onChange({target:{value}});await f.h.flush();}
async function prepareCurrent(f){await button(f.h,'branchPrepare').props.onClick();await f.h.flush();}

test('old prepare/read/close and selection handlers cannot act on B → C → B or same-value selections',async()=>{
 for(const choices of [[C.name,B.name],[B.name]]){
  const f=fixture({'vcs/branches':list});try{
   await open(f);await select(f,B.name);
   const oldPrepare=button(f.h,'branchPrepare').props.onClick,oldRead=button(f.h,'branchRead').props.onClick,oldClose=button(f.h,'branchSwitcher').props.onClick,oldSelect=input(f.h,'branchTarget').props.onChange;
   for(const value of choices)await select(f,value);
   const before=f.calls.length;
   await oldPrepare();await oldRead();oldClose();oldSelect({target:{value:C.name}});await f.h.flush();
   assert.equal(f.calls.length,before);assert.equal(input(f.h,'branchTarget').props.value,B.name);
   await prepareCurrent(f);assert.equal(f.calls.at(-1).p.branch,B.name);assert.ok(button(f.h,'branchConfirm'));
  }finally{f.h.dispose();}
 }
});

test('B → C invalidates old prepare synchronously and fresh prepare submits C',async()=>{
 const f=fixture({'vcs/branches':list,'vcs/branch-switch-prepare':p=>result(p.branch===C.name?C:B)});try{
  await open(f);await select(f,B.name);const oldPrepare=button(f.h,'branchPrepare').props.onClick,oldRead=button(f.h,'branchRead').props.onClick,oldClose=button(f.h,'branchSwitcher').props.onClick;
  input(f.h,'branchTarget').props.onChange({target:{value:C.name}});const before=f.calls.length;
  await oldPrepare();await oldRead();oldClose();await f.h.flush();assert.equal(f.calls.length,before);assert.equal(input(f.h,'branchTarget').props.value,C.name);
  await prepareCurrent(f);assert.equal(f.calls.at(-1).p.branch,C.name);assert.ok(nodeText(f.h.tree).includes(C.commit));
  oldClose();await f.h.flush();assert.ok(button(f.h,'branchConfirm'));button(f.h,'branchCancel').props.onClick();await f.h.flush();assert.equal(count(f,'vcs/branch-switch-confirm'),0);
 }finally{f.h.dispose();}
});

test('old preview cancel and confirm cannot consume a fresh candidate, even with the same token text',async()=>{
 const f=fixture();try{
  await open(f);await select(f,B.name);await prepareCurrent(f);
  const oldCancel=button(f.h,'branchCancel').props.onClick,oldConfirm=button(f.h,'branchConfirm').props.onClick;
  oldCancel();await f.h.flush();await prepareCurrent(f);const fresh=button(f.h,'branchConfirm');
  oldCancel();await oldConfirm();await f.h.flush();assert.ok(button(f.h,'branchConfirm'));assert.equal(count(f,'vcs/branch-switch-confirm'),0);
  await fresh.props.onClick();await f.h.flush();assert.equal(count(f,'vcs/branch-switch-confirm'),1);assert.equal(f.refreshes,1);
 }finally{f.h.dispose();}
});

test('list reset retires old prepare/read/close even when the new list rejects',async()=>{
 let reads=0;const f=fixture({'vcs/branches':()=>++reads===1?list():Promise.reject(Error('list failed'))});try{
  await open(f);await select(f,B.name);const oldPrepare=button(f.h,'branchPrepare').props.onClick,oldRead=button(f.h,'branchRead').props.onClick,oldClose=button(f.h,'branchSwitcher').props.onClick;
  await button(f.h,'branchRead').props.onClick();await f.h.flush();const before=f.calls.length;
  await oldPrepare();await oldRead();oldClose();await f.h.flush();assert.equal(f.calls.length,before);assert.match(nodeText(f.h.tree),/list failed/);assert.ok(button(f.h,'branchRead'));assert.equal(button(f.h,'branchConfirm'),undefined);
 }finally{f.h.dispose();}
});

test('accepted list retires the prior read handler without leaving the fresh list locked',async()=>{
 const f=fixture({'vcs/branches':list});try{
  await open(f);const oldRead=button(f.h,'branchRead').props.onClick;await oldRead();await f.h.flush();
  await select(f,C.name);const before=f.calls.length;await oldRead();await f.h.flush();assert.equal(f.calls.length,before);assert.equal(input(f.h,'branchTarget').props.value,C.name);
  await select(f,B.name);await prepareCurrent(f);assert.ok(button(f.h,'branchConfirm'));
 }finally{f.h.dispose();}
});

test('late prepare/list resolve or rejection after scope cancellation cannot overwrite or unlock the new task',async()=>{
 for(const endpoint of ['vcs/branches','vcs/branch-switch-prepare'])for(const reject of [false,true]){
  const old=deferred(),fresh=deferred();let requests=0;
  const f=fixture({[endpoint]:()=>++requests===1?old.promise:fresh.promise});try{
   await f.h.flush();button(f.h,'branchSwitcher').props.onClick();await f.h.flush();
   if(endpoint!=='vcs/branches'){await select(f,B.name);button(f.h,'branchPrepare').props.onClick();await f.h.flush();}
   const prior=f.calls.at(-1);f.h.update({...f.props,repositoryId:'next'});await f.h.flush();assert.equal(prior.signal.aborted,true);
   button(f.h,'branchSwitcher').props.onClick();await f.h.flush();
   if(endpoint!=='vcs/branches'){await select(f,B.name);button(f.h,'branchPrepare').props.onClick();await f.h.flush();}
   const current=f.calls.at(-1),before=f.calls.length;
   if(reject)old.reject(Error('retired failure'));else old.resolve(endpoint==='vcs/branches'?list():result());await f.h.flush();
   assert.equal(button(f.h,'branchSwitcher').props.disabled,true);assert.equal(current.signal.aborted,false);assert.equal(button(f.h,'branchConfirm'),undefined);assert.doesNotMatch(nodeText(f.h.tree),/retired failure/);
   await button(f.h,'branchSwitcher').props.onClick();assert.equal(f.calls.length,before);
   fresh.resolve(endpoint==='vcs/branches'?list():result());await f.h.flush();assert.equal(button(f.h,'branchSwitcher').props.disabled,false);
   if(endpoint==='vcs/branches')assert.ok(input(f.h,'branchTarget'));else assert.ok(button(f.h,'branchConfirm'));
  }finally{old.resolve(list());fresh.resolve(list());f.h.dispose();}
 }
});

test('pending and blocked live access reject late list/prepare success and failure',async()=>{
 for(const flag of ['pending','blocked'])for(const endpoint of ['vcs/branches','vcs/branch-switch-prepare'])for(const reject of [false,true]){
  const held=deferred();const f=fixture({[endpoint]:()=>held.promise});try{
   await f.h.flush();button(f.h,'branchSwitcher').props.onClick();await f.h.flush();
   if(endpoint!=='vcs/branches'){await select(f,B.name);button(f.h,'branchPrepare').props.onClick();await f.h.flush();}
   f.h.update({...f.props,[flag]:true});await f.h.flush();if(reject)held.reject(Error('late blocked error'));else held.resolve(endpoint==='vcs/branches'?list():result());await f.h.flush();
   assert.equal(button(f.h,'branchConfirm'),undefined);assert.doesNotMatch(nodeText(f.h.tree),/late blocked error/);assert.equal(count(f,'vcs/branch-switch-confirm'),0);
  }finally{held.resolve(list());f.h.dispose();}
 }
});

test('pre-write selection/preview cancellation is definite; confirm cancellation remains unknown',async()=>{
 const f=fixture();try{
  await open(f);await select(f,B.name);await prepareCurrent(f);const oldConfirm=button(f.h,'branchConfirm').props.onClick;
  button(f.h,'branchCancel').props.onClick();await f.h.flush();await oldConfirm();await f.h.flush();assert.equal(count(f,'vcs/branch-switch-confirm'),0);assert.doesNotMatch(nodeText(f.h.tree),/branchUnknown/);assert.equal(f.refreshes,0);
 }finally{f.h.dispose();}
 const held=deferred(),g=fixture({'vcs/branch-switch-confirm':()=>held.promise});try{
  await open(g);await select(g,B.name);await prepareCurrent(g);const writing=button(g.h,'branchConfirm').props.onClick();await g.h.flush();const cancel=button(g.h,'branchCancel').props.onClick;
  cancel();await g.h.flush();assert.equal(g.calls.at(-1).signal.aborted,true);assert.match(nodeText(g.h.tree),/branchUnknown/);held.resolve({current:B});await writing;await g.h.flush();cancel();assert.equal(g.refreshes,0);assert.equal(count(g,'vcs/branch-switch-confirm'),1);
 }finally{held.resolve({current:B});g.h.dispose();}
});
