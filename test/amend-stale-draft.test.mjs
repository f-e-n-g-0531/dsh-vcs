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
const identity=()=>({name:'Explicit Name',email:'explicit@example.test',timestamp:1700000000,timezone:'+0800'});
const draft=()=>({committer:{...identity(),name:'Separate Committer'},message:'Exact message\n'});
const candidate=(p=draft(),width=40)=>({action:'amend',head:'a'.repeat(width),ref:'refs/heads/main',objectFormat:width===40?'sha1':'sha256',indexDigest:'b'.repeat(64),previousTree:'9'.repeat(width),parents:['8'.repeat(width)],tree:'c'.repeat(width),commit:{oid:'d'.repeat(width)},author:identity(),committer:{...p.committer},message:p.message,token:'e'.repeat(64),expiresAt:Date.now()+59000});
const success=p=>({head:p.commit.oid,ref:p.ref,tree:p.tree,indexDigest:p.indexDigest});
function fixture(overrides={},environment={}){
 const calls=[];let unknowns=0,amended=0,rediscovered=0,prepared;
 const props={sessionId:'s',repositoryId:'r',mode:'staged',refresh:0,t:k=>k,onUnknown:()=>unknowns++,onAmended:()=>amended++,onRediscover:()=>rediscovered++,rpc:async(e,p,signal)=>{calls.push({e,p,signal});if(overrides[e])return overrides[e](p,signal);if(e==='vcs/amend-prepare')return prepared=candidate(p);if(e==='vcs/amend-confirm')return success(prepared);throw Error(e);}};
 const h=frontendHarness('src/AmendPanel.jsx',props,environment);return {h,calls,props,get unknowns(){return unknowns;},get amended(){return amended;},get rediscovered(){return rediscovered;}};
}
async function fill(h){for(const [role,value] of Object.entries(draft())){if(role==='message'){findNode(h,n=>n.type==='textarea').props.onChange({target:{value}});await h.flush();continue;}for(const [key,text] of Object.entries(value)){input(h,(role==='author'?'commitAuthor':'commitCommitter')+' commit'+key).props.onChange({target:{value:String(text)}});await h.flush();}}}
async function prepare(f){button(f.h,'amendPrepare').props.onClick();await f.h.flush();}
async function ack(f){input(f.h,'amendAcknowledge').props.onChange({target:{checked:true}});await f.h.flush();}
test('old amend prepare and cancel cannot act on edited draft',async()=>{const f=fixture();try{await f.h.flush();await fill(f.h);const oldPrepare=button(f.h,'amendPrepare'),oldCancel=button(f.h,'amendCancel');findNode(f.h,n=>n.type==='textarea').props.onChange({target:{value:'replacement'}});await f.h.flush();await oldPrepare.props.onClick();await f.h.flush();assert.equal(f.calls.length,0);await prepare(f);assert.ok(button(f.h,'amendConfirm'));oldCancel.props.onClick();await f.h.flush();assert.ok(button(f.h,'amendConfirm'));}finally{f.h.dispose();}});

const editableFields=[
 ['commitCommitter commitname','Replacement Name'],
 ['commitCommitter commitemail','replacement@example.test'],
 ['commitCommitter committimestamp','1700000001'],
 ['commitCommitter committimezone','+0900'],
 ['commitMessage','Replacement message'],
];
const draftInput=(h,label)=>label==='commitMessage'?findNode(h,n=>n.type==='textarea'):input(h,label);
async function editDraft(h,label,value){draftInput(h,label).props.onChange({target:{value}});await h.flush();}
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

for(const [label,replacement] of editableFields)for(const sequence of ['same-value','A-B-A']){
 test(label+' '+sequence+' edit burns retained prepare/cancel without clearing replacement',async()=>{
  const f=fixture();try{
   await f.h.flush();await fill(f.h);
   const original=draftInput(f.h,label).props.value,oldPrepare=button(f.h,'amendPrepare'),oldCancel=button(f.h,'amendCancel');
   if(sequence==='A-B-A')await editDraft(f.h,label,replacement);
   await editDraft(f.h,label,original);
   await oldPrepare.props.onClick();await f.h.flush();assert.equal(f.calls.length,0,'retained prepare cannot send, even when text equals A');
   await prepare(f);await ack(f);const confirmation=button(f.h,'amendConfirm');
   assert.equal(f.calls.length,1);assert.equal(confirmation.props.disabled,false);
   oldCancel.props.onClick();await f.h.flush();await oldPrepare.props.onClick();await f.h.flush();
   assert.equal(f.calls.length,1,'retained callbacks send no RPC');
   assert.equal(button(f.h,'amendConfirm').props.disabled,false,'retained cancel preserves replacement preview and acknowledgement');
   assert.equal(input(f.h,'amendAcknowledge').props.checked,true);
   assert.equal(draftInput(f.h,label).props.value,original);
   assert.equal(f.amended,0);assert.equal(f.unknowns,0);
  }finally{f.h.dispose();}
 });
}

test('current cancel invalidates retained prepare and permits only a fresh preparation',async()=>{
 const f=fixture();try{
  await f.h.flush();await fill(f.h);const oldPrepare=button(f.h,'amendPrepare');
  button(f.h,'amendCancel').props.onClick();await f.h.flush();
  await oldPrepare.props.onClick();await f.h.flush();assert.equal(f.calls.length,0);
  assert.equal(draftInput(f.h,'commitMessage').props.value,draft().message);
  await prepare(f);assert.equal(f.calls.length,1);assert.ok(button(f.h,'amendConfirm'));assert.equal(input(f.h,'amendAcknowledge').props.checked,false);
 }finally{f.h.dispose();}
});

for(const outcome of ['success','error'])test('late old '+outcome+' cannot unlock a new busy preparation',async()=>{
 const requests=[];const f=fixture({'vcs/amend-prepare':p=>{const d=deferred();requests.push({...d,p});return d.promise;}});try{
  await f.h.flush();await fill(f.h);const oldTask=button(f.h,'amendPrepare').props.onClick();await f.h.flush();
  await editDraft(f.h,'commitMessage','new active draft');assert.equal(f.calls[0].signal.aborted,true);
  const newPrepare=button(f.h,'amendPrepare'),newTask=newPrepare.props.onClick();await f.h.flush();assert.equal(f.calls.length,2);
  if(outcome==='success')requests[0].resolve(candidate(requests[0].p));else requests[0].reject(Object.assign(Error('old failure'),{code:'vcs/rediscover-required'}));
  await oldTask;await f.h.flush();
  assert.equal(button(f.h,'amendPrepare').props.disabled,true);assert.equal(findNode(f.h,n=>n.type==='section'&&n.props['aria-label']==='amendTitle').props['aria-busy'],true);
  assert.equal(button(f.h,'amendConfirm'),undefined);assert.ok(!nodeText(f.h.tree).includes('old failure'));assert.equal(f.rediscovered,0);
  await newPrepare.props.onClick();await f.h.flush();assert.equal(f.calls.length,2,'old finally must not release the current lock');
  requests[1].resolve(candidate(requests[1].p));await newTask;await f.h.flush();assert.ok(button(f.h,'amendConfirm'));assert.equal(button(f.h,'amendPrepare').props.disabled,false);
  assert.equal(draftInput(f.h,'commitMessage').props.value,'new active draft');
 }finally{f.h.dispose();}
});

for(const guard of ['pending','blocked'])for(const outcome of ['success','error'])test('live '+guard+' blocks retained prepare and late '+outcome,async()=>{
 const request=deferred();const f=fixture({'vcs/amend-prepare':()=>request.promise});try{
  await f.h.flush();await fill(f.h);const retained=button(f.h,'amendPrepare');
  f.h.update({...f.props,[guard]:true});await f.h.flush();await retained.props.onClick();await f.h.flush();assert.equal(f.calls.length,0,'live guard applies to retained unblocked handler');
  f.h.update({...f.props,[guard]:false});await f.h.flush();const active=button(f.h,'amendPrepare').props.onClick();await f.h.flush();assert.equal(f.calls.length,1);
  f.h.update({...f.props,[guard]:true});await f.h.flush();
  if(outcome==='success')request.resolve(candidate(f.calls[0].p));else request.reject(Object.assign(Error('guarded old failure'),{code:'vcs/rediscover-required'}));
  await active;await f.h.flush();assert.equal(button(f.h,'amendConfirm'),undefined);assert.ok(!nodeText(f.h.tree).includes('guarded old failure'));assert.equal(f.rediscovered,0);assert.equal(f.amended,0);assert.equal(f.unknowns,0);
  await retained.props.onClick();await f.h.flush();assert.equal(f.calls.length,1);assert.equal(button(f.h,'amendPrepare').props.disabled,true);
 }finally{f.h.dispose();}
});
