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
const count=(f,e)=>f.calls.filter(c=>c.e===e).length;

test('production branch-switch-shared: strict default all keeps mutation panels absent without RPC across loaded and pending states',async()=>{
 for(const state of ['modified','added','deleted','MM','empty','error','pending-status','scanning','svn']){
  const calls=[];let discover;
  const entry={id:'f',path:'f',status:['added','deleted'].includes(state)?state:'modified',indexStatus:state==='MM'?'M':' ',worktreeStatus:'M'};
  const rpc=async(e,p)=>{calls.push({e,p});if(e==='vcs/repositories'){const value={cwd:'/w',repositories:[{id:'r',type:state==='svn'?'svn':'git',relativePath:'.'}]};if(state==='scanning')return new Promise(done=>discover=()=>done(value));return value;}if(e==='vcs/status'){assert.equal(p.mode,'all');if(state==='pending-status')return new Promise(()=>{});if(state==='error')throw Error('status failed');return {changes:state==='empty'?[]:[entry]};}if(e==='vcs/compare'){assert.equal(p.mode,'all');return {...entry,left:{label:'HEAD',text:'a'},right:{label:'Worktree',text:'b'}};}if(e==='vcs/svn-identity')return {};throw Error('Unexpected production RPC '+e);};
  const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})});
  const absent=()=>{assert.ok(calls.filter(c=>['vcs/status','vcs/compare'].includes(c.e)).every(c=>c.p.mode==='all'));assert.equal(input(h,'gitMode'),undefined);for(const name of ['BranchSwitcher','BranchCreate','TagCreate','LightweightTagCreate','BranchDeletePreview','CommitPanel','AmendPanel','IndexStage','IndexUnstage','PartialStage','PartialUnstage','LineStage','LineUnstage'])assert.equal(findNode(h,n=>typeof n.type==='function'&&n.type.name===name),undefined,name);for(const label of ['branchSwitcher','branchCreatePrepare','tagCreatePrepare','lightweightTagPrepare','branchDeletePreviewAssess','commitPrepare','amendPrepare','stagePrepare','unstagePrepare','partialPlan','partialUnstagePlan','linePlan'])assert.equal(button(h,label),undefined,label);assert.deepEqual(calls.filter(c=>!['vcs/repositories','vcs/status','vcs/compare','vcs/svn-identity'].includes(c.e)),[]);};
  try{await h.flush();absent();if(discover){discover();await h.flush();absent();}const file=findNode(h,n=>n.type==='button'&&n.props['data-vcs-change']);if(file){file.props.onClick();await h.flush();absent();assert.ok(calls.some(c=>c.e==='vcs/compare'));}assert.ok(calls.some(c=>c.e==='vcs/status'));}finally{h.dispose();}
 }
});

test('production branch-switch-shared: refresh, focus, repository selection and review return never expose mutation entry points',async()=>{
 const calls=[],events=new Map(),win={addEventListener:(e,fn)=>events.set(e,fn),removeEventListener:e=>events.delete(e)};
 const rpc=async(e,p)=>{calls.push({e,p});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'},{id:'other',type:'git',relativePath:'other'},{id:'svn',type:'svn',relativePath:'svn'}]};if(e==='vcs/status'){assert.equal(p.mode,'all');return {changes:[]};}if(e==='vcs/history')return {snapshot:'a'.repeat(40),commits:[],nextOffset:null};if(e==='vcs/svn-identity')return {};throw Error('Unexpected production RPC '+e);};
 const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})},{window:win});
 const absent=()=>{assert.ok(calls.filter(c=>['vcs/status','vcs/compare'].includes(c.e)).every(c=>c.p.mode==='all'));assert.equal(input(h,'gitMode'),undefined);assert.equal(findNode(h,n=>typeof n.type==='function'&&['BranchSwitcher','BranchCreate','TagCreate','LightweightTagCreate','BranchDeletePreview','CommitPanel','AmendPanel','IndexStage','IndexUnstage','PartialStage','PartialUnstage','LineStage','LineUnstage'].includes(n.type.name)),undefined);assert.deepEqual(calls.filter(c=>!['vcs/repositories','vcs/status','vcs/history','vcs/svn-identity'].includes(c.e)),[]);};
 try{await h.flush();absent();for(const id of ['other','svn','r']){input(h,'repositories').props.onChange({target:{value:id}});await h.flush();absent();}const before=calls.filter(c=>c.e==='vcs/status').length;button(h,'refresh').props.onClick();await h.flush();events.get('focus')?.({target:win});await h.flush();absent();assert.ok(calls.filter(c=>c.e==='vcs/status').length>before);button(h,'allCommits').props.onClick();await h.flush();absent();assert.ok(calls.some(c=>c.e==='vcs/history'));button(h,'localChanges').props.onClick();await h.flush();absent();}finally{h.dispose();}
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
