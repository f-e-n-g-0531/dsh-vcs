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

function production(rpc,environment={}){return frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})},environment);}
const selectedEntry={id:'f',path:'f',status:'modified',indexStatus:'M',worktreeStatus:' '};
async function staged(h){input(h,'gitMode').props.onChange({target:{value:'staged'}});await h.flush();}
async function selectFile(h){findNode(h,n=>n.type==='button'&&n.props['data-vcs-change']).props.onClick();await h.flush();}

const candidate=(p={name:'topic/new'},width=40)=>({action:'branch-create',name:p.name,ref:'refs/heads/'+p.name,target:{oid:'a'.repeat(width)},head:'a'.repeat(width),currentRef:'refs/heads/main',objectFormat:width===40?'sha1':'sha256',token:'e'.repeat(64),expiresAt:Date.now()+59000});
const success=p=>({name:p.name,ref:p.ref,commit:p.target.oid,currentRef:p.currentRef});
function fixture(overrides={},environment={}){
 const calls=[];let unknowns=0,created=0,rediscovered=0,prepared;
 const props={sessionId:'s',repositoryId:'r',mode:'all',refresh:0,scope:0,t:k=>k,onUnknown:()=>unknowns++,onCreated:()=>created++,onRediscover:()=>rediscovered++,rpc:async(e,p,signal)=>{calls.push({e,p,signal});if(overrides[e])return overrides[e](p,signal);if(e==='vcs/branch-create-prepare')return prepared=candidate(p);if(e==='vcs/branch-create-confirm')return success(prepared);throw Error(e);}};
 const h=frontendHarness('src/BranchCreate.jsx',props,environment);return {h,calls,props,get unknowns(){return unknowns;},get created(){return created;},get rediscovered(){return rediscovered;}};
}
async function fill(h,name='topic/new'){input(h,'branchCreateName').props.onChange({target:{value:name}});await h.flush();}
async function prepare(f){button(f.h,'branchCreatePrepare').props.onClick();await f.h.flush();}
async function ack(f){input(f.h,'branchCreateAcknowledge').props.onChange({target:{checked:true}});await f.h.flush();}
test('old branch prepare and cancel cannot act on replacement draft',async()=>{const f=fixture();try{await f.h.flush();await fill(f.h);const oldPrepare=button(f.h,'branchCreatePrepare'),oldCancel=button(f.h,'branchCreateCancel');await fill(f.h,'other');await oldPrepare.props.onClick();await f.h.flush();assert.equal(f.calls.length,0);await prepare(f);assert.ok(button(f.h,'branchCreateConfirm'));oldCancel.props.onClick();await f.h.flush();assert.ok(button(f.h,'branchCreateConfirm'));assert.equal(f.calls.length,1);}finally{f.h.dispose();}});