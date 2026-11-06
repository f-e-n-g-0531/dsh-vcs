import test from 'node:test';
import assert from 'node:assert/strict';
import {transformSync} from 'esbuild';
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

test('fixed preview expires against live clock without relying on mutable RPC metadata',async()=>{
 let now=Date.now();class Clock extends Date {static now(){return now;}}const f=fixture({}, {Date:Clock});try{await f.h.flush();await preview(f);const old=button(f.h,'branchConfirm');now+=62000;await old.props.onClick();await f.h.flush();assert.equal(f.calls.some(c=>c.e==='vcs/branch-switch-confirm'),false);assert.match(nodeText(f.h.tree),/branchExpired/);}finally{f.h.dispose();}
});

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const endpoints=['index-stage','index-unstage','partial-stage','partial-unstage','line-stage','line-unstage','commit','amend','branch-create'];
function production(overrides={}){
 const calls=[],events=new Map();const win={addEventListener:(e,fn)=>events.set(e,fn),removeEventListener:(e,fn)=>{if(events.get(e)===fn)events.delete(e);}};
 const rpc=async(e,p,signal)=>{calls.push({e,p,signal});if(overrides[e])return overrides[e](p,signal);if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'},{id:'other',type:'git',relativePath:'other'}]};if(e==='vcs/status')return {changes:[{id:'f',path:'f',status:'modified',indexStatus:'M',worktreeStatus:' '}]};if(e==='vcs/compare')return {path:'f',status:'modified',left:{text:'a',label:'HEAD'},right:{text:'b',label:'Index'}};if(e==='vcs/branches')return {current:A,branches:[A,B]};if(e==='vcs/branch-switch-prepare')return {token:'f'.repeat(64),expiresAt:Date.now()+59000,current:A,target:B};if(e==='vcs/branch-switch-confirm')return {current:B};throw Error(e);};
 const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})},{window:win});return {h,calls,focus:()=>events.get('focus')?.({target:win})};
}
const component=(h,name)=>findNode(h,n=>typeof n.type==='function'&&n.type.name===name);
const switchProps=h=>component(h,'BranchSwitcher').props;
const count=(f,e)=>f.calls.filter(c=>c.e===e).length;
const mode=async(h,value)=>{input(h,'gitMode').props.onChange({target:{value}});await h.flush();};

test('all nine neighboring confirms exclude switch both directions synchronously through retained shared RPC',async()=>{
 for(const op of endpoints)for(const direction of ['switch-first','neighbor-first']){
  const held=deferred(),endpoint='vcs/'+op+'-confirm',first=direction==='switch-first'?'vcs/branch-switch-confirm':endpoint,second=direction==='switch-first'?endpoint:'vcs/branch-switch-confirm';
  const f=production({[first]:()=>held.promise});try{await f.h.flush();const rpc=switchProps(f.h).rpc;const pending=rpc(first,{sessionId:'s',repositoryId:'r',token:'a'},new AbortController().signal);await assert.rejects(rpc(second,{sessionId:'s',repositoryId:'r',token:'b'}),e=>e.code==='vcs/busy');
   for(const read of ['vcs/branches','vcs/branch-switch-prepare'])await assert.rejects(rpc(read,{sessionId:'s',repositoryId:'r'}),e=>e.code==='vcs/busy');
   assert.equal(count(f,second),0);assert.equal(count(f,first),1);held.resolve({});await pending;
  }finally{held.resolve({});f.h.dispose();}
 }
});

test('old switch read prepare confirm handlers honor current blocked and pending props',async()=>{
 for(const flag of ['blocked','pending']){const f=fixture();try{await f.h.flush();await preview(f);const oldConfirm=button(f.h,'branchConfirm'),oldRead=button(f.h,'branchRead');button(f.h,'branchCancel').props.onClick();await f.h.flush();const oldPrepare=button(f.h,'branchPrepare');button(f.h,'branchPrepare').props.onClick();await f.h.flush();const currentConfirm=button(f.h,'branchConfirm');f.h.update({...f.props,[flag]:true});await f.h.flush();const before=f.calls.length;await oldRead.props.onClick();await oldPrepare.props.onClick();await oldConfirm.props.onClick();await currentConfirm.props.onClick();assert.equal(f.calls.length,before);}finally{f.h.dispose();}}
});

test('old confirmation cannot consume a new candidate and validated metadata is detached',async()=>{
 let raw;const f=fixture({'vcs/branch-switch-prepare':async()=>raw={token:'d'.repeat(64),expiresAt:Date.now()+59000,current:{...A},target:{...B}}});try{await f.h.flush();await preview(f);const old=button(f.h,'branchConfirm');button(f.h,'branchCancel').props.onClick();await f.h.flush();await button(f.h,'branchPrepare').props.onClick();await f.h.flush();raw.target.commit=A.commit;raw.token='0'.repeat(64);raw.expiresAt=0;await old.props.onClick();assert.equal(count(f,'vcs/branch-switch-confirm'),0);await button(f.h,'branchConfirm').props.onClick();assert.equal(f.calls.at(-1).p.token,'d'.repeat(64));assert.equal(f.refreshes,1);}finally{f.h.dispose();}
});

test('cancel unmount and every scope change mark parent unknown and suppress late confirm success',async()=>{
 for(const action of ['cancel','sessionId','repositoryId','refresh','mode','scope','unmount']){const held=deferred();let unknowns=0;const f=fixture({'vcs/branch-switch-confirm':()=>held.promise});f.props.onUnknown=()=>unknowns++;try{await f.h.flush();await preview(f);const old=button(f.h,'branchConfirm'),pending=old.props.onClick();await f.h.flush();if(action==='cancel')button(f.h,'branchCancel').props.onClick();else if(action==='unmount')f.h.dispose();else f.h.update({...f.props,[action]:'next'});if(action!=='unmount')await f.h.flush();assert.equal(f.calls.at(-1).signal.aborted,true,action);assert.equal(unknowns,1,action);held.resolve({current:B});await pending;await old.props.onClick();assert.equal(f.refreshes,0);assert.equal(count(f,'vcs/branch-switch-confirm'),1);}finally{held.resolve({current:B});f.h.dispose();}}
});

test('shared unknown survives mode focus and repository changes, blocks reads, explicit recovery clears only that repo',async()=>{
 const f=production({'vcs/branch-switch-confirm':async()=>{throw Error('lost');}});try{await f.h.flush();await preview(f);await button(f.h,'branchConfirm').props.onClick();await f.h.flush();assert.equal(switchProps(f.h).blocked,true);const stale=switchProps(f.h).rpc;await mode(f.h,'staged');f.focus();await f.h.flush();assert.equal(switchProps(f.h).blocked,true);input(f.h,'repositories').props.onChange({target:{value:'other'}});await f.h.flush();assert.equal(switchProps(f.h).blocked,false);input(f.h,'repositories').props.onChange({target:{value:'r'}});await f.h.flush();assert.equal(switchProps(f.h).blocked,true);for(const e of ['vcs/branches','vcs/branch-switch-prepare'])await assert.rejects(stale(e,{repositoryId:'r',sessionId:'s'}));const before=count(f,'vcs/repositories');switchProps(f.h).onRediscover();await f.h.flush();assert.equal(switchProps(f.h).blocked,false);assert.equal(count(f,'vcs/repositories'),before+1);
  await assert.rejects(switchProps(f.h).rpc('vcs/branch-switch-confirm',{repositoryId:'r',sessionId:'s'}));await f.h.flush();button(f.h,'refresh').props.onClick();await f.h.flush();assert.equal(switchProps(f.h).blocked,false);
 }finally{f.h.dispose();}
});

test('switch preview survives file selection; pending recovery and explicit refresh do not clear the barrier',async()=>{
 const held=deferred(),f=production({'vcs/branch-switch-confirm':()=>held.promise});try{await f.h.flush();await mode(f.h,'staged');await preview(f);findNode(f.h,n=>n.type==='button'&&n.props['data-vcs-change']).props.onClick();await f.h.flush();assert.ok(button(f.h,'branchConfirm'));const old=switchProps(f.h),pending=button(f.h,'branchConfirm').props.onClick();old.onRediscover();button(f.h,'refresh').props.onClick();await f.h.flush();assert.equal(switchProps(f.h).pending,true);button(f.h,'branchCancel').props.onClick();await f.h.flush();assert.equal(switchProps(f.h).blocked,true);held.resolve({current:B});await pending;await f.h.flush();assert.equal(count(f,'vcs/repositories'),1);assert.equal(switchProps(f.h).blocked,true);}finally{held.resolve({current:B});f.h.dispose();}
});
