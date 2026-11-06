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

const identity=()=>({name:'Explicit Name',email:'explicit@example.test',timestamp:1700000000,timezone:'+0800'});
const draft=()=>({author:identity(),committer:{...identity(),name:'Separate Committer'},message:'Exact message\n'});
const candidate=(p=draft(),width=40)=>({action:'commit',head:'a'.repeat(width),ref:'refs/heads/main',objectFormat:width===40?'sha1':'sha256',indexDigest:'b'.repeat(64),tree:'c'.repeat(width),commit:{oid:'d'.repeat(width)},author:{...p.author},committer:{...p.committer},message:p.message,token:'e'.repeat(64),expiresAt:Date.now()+59000});
const success=p=>({head:p.commit.oid,ref:p.ref,tree:p.tree,indexDigest:p.indexDigest});
function fixture(overrides={},environment={}){
 const calls=[];let unknowns=0,committed=0,rediscovered=0,prepared;
 const props={sessionId:'s',repositoryId:'r',mode:'staged',refresh:0,t:k=>k,onUnknown:()=>unknowns++,onCommitted:()=>committed++,onRediscover:()=>rediscovered++,rpc:async(e,p,signal)=>{calls.push({e,p,signal});if(overrides[e])return overrides[e](p,signal);if(e==='vcs/commit-prepare')return prepared=candidate(p);if(e==='vcs/commit-confirm')return success(prepared);throw Error(e);}};
 const h=frontendHarness('src/CommitPanel.jsx',props,environment);return {h,calls,props,get unknowns(){return unknowns;},get committed(){return committed;},get rediscovered(){return rediscovered;}};
}
async function fill(h){for(const [role,value] of Object.entries(draft())){if(role==='message'){findNode(h,n=>n.type==='textarea').props.onChange({target:{value}});await h.flush();continue;}for(const [key,text] of Object.entries(value)){input(h,(role==='author'?'commitAuthor':'commitCommitter')+' commit'+key).props.onChange({target:{value:String(text)}});await h.flush();}}}
async function prepare(f){button(f.h,'commitPrepare').props.onClick();await f.h.flush();}
async function ack(f){input(f.h,'commitAcknowledge').props.onChange({target:{checked:true}});await f.h.flush();}
const latest=(message='Latest exact\n',width=40)=>({head:'1'.repeat(width),ref:'refs/heads/main',objectFormat:width===40?'sha1':'sha256',tree:'2'.repeat(width),parents:['3'.repeat(width)],author:{...identity(),name:'Historic Author'},committer:{...identity(),name:'Historic Committer'},message,messageBytes:Buffer.byteLength(message)});
const textarea=h=>findNode(h,n=>n.type==='textarea');
const readLatest=async f=>{button(f.h,'commitLatestLoad').props.onClick();await f.h.flush();};
const reuse= f=>button(f.h,'commitLatestReuse').props.onClick();
test('dedicated read cancel preserves existing candidate acknowledgement and draft',async()=>{let finish;const f=fixture({'vcs/latest-commit':()=>new Promise(resolve=>{finish=resolve;})});try{await f.h.flush();await fill(f.h);await prepare(f);await ack(f);const before=textarea(f.h).props.value;await readLatest(f);button(f.h,'commitLatestCancel').props.onClick();await f.h.flush();assert.equal(f.calls.at(-1).signal.aborted,true);assert.equal(textarea(f.h).props.value,before);assert.equal(input(f.h,'commitAcknowledge').props.checked,true);assert.equal(button(f.h,'commitConfirm').props.disabled,false);finish(latest());await f.h.flush();assert.equal(button(f.h,'commitLatestReuse'),undefined);assert.equal(f.unknowns,0);}finally{f.h.dispose();}});
test('read is explicit scope-only and preserves draft, preview and acknowledgement; reuse burns them synchronously and preserves identities',async()=>{
 const f=fixture({'vcs/latest-commit':async()=>latest()});try{await f.h.flush();assert.equal(f.calls.length,0);await fill(f.h);await prepare(f);await ack(f);const old=button(f.h,'commitConfirm');await readLatest(f);assert.equal(textarea(f.h).props.value,draft().message);assert.equal(input(f.h,'commitAcknowledge').props.checked,true);assert.equal(JSON.stringify(f.calls.at(-1).p),JSON.stringify({sessionId:'s',repositoryId:'r'}));assert.equal(f.calls[0].signal.aborted,false);assert.ok(nodeText(f.h.tree).includes('Historic Author'));reuse(f);await old.props.onClick();assert.equal(f.calls.length,2);await f.h.flush();assert.equal(button(f.h,'commitConfirm'),undefined);assert.equal(textarea(f.h).props.value,latest().message);await prepare(f);assert.equal(JSON.stringify(f.calls.at(-1).p.author),JSON.stringify(draft().author));assert.equal(JSON.stringify(f.calls.at(-1).p.committer),JSON.stringify(draft().committer));assert.equal(input(f.h,'commitAcknowledge').props.checked,false);await ack(f);const count=f.calls.length;await old.props.onClick();assert.equal(f.calls.length,count);}finally{f.h.dispose();}
});
test('CRLF, BOM and empty messages read/reuse rawexact but existing write policy rejects without normalization or RPC',async()=>{
 for(const message of ['a\r\nb\r\n','\ufefftext\n','']){const f=fixture({'vcs/latest-commit':async()=>latest(message)});try{await f.h.flush();await fill(f.h);await readLatest(f);assert.equal(nodeText(findNode(f.h,n=>n.type==='pre'&&n.props['aria-label']==='commitLatestMessage')),message);reuse(f);await f.h.flush();assert.equal(textarea(f.h).props.value,message);await prepare(f);assert.equal(f.calls.length,1);assert.ok(nodeText(f.h.tree).includes('commitInvalidDraft'));assert.equal(textarea(f.h).props.value,message);}finally{f.h.dispose();}}
});
test('reading uses independent abort controller; explicit reuse aborts inflight prepare and discards late candidate',async()=>{
 let finish;const f=fixture({'vcs/latest-commit':async()=>latest(),'vcs/commit-prepare':()=>new Promise(done=>finish=done)});try{await f.h.flush();await fill(f.h);await prepare(f);await readLatest(f);assert.equal(f.calls[0].signal.aborted,false);reuse(f);assert.equal(f.calls[0].signal.aborted,true);finish(candidate(f.calls[0].p));await f.h.flush();assert.equal(button(f.h,'commitConfirm'),undefined);assert.equal(textarea(f.h).props.value,latest().message);}finally{f.h.dispose();}
});
test('late read discarded on cancel, unmount and every scope key; saved handlers cannot cross scope',async()=>{
 for(const action of ['cancel','unmount','sessionId','repositoryId','refresh','mode','scope']){let finish;const f=fixture({'vcs/latest-commit':()=>new Promise(done=>finish=done)});try{await f.h.flush();const old=button(f.h,'commitLatestLoad');await readLatest(f);if(action==='cancel')button(f.h,'commitCancel').props.onClick();else if(action==='unmount')f.h.dispose();else f.h.update({...f.props,[action]:action==='refresh'?1:'next'});await f.h.flush();assert.equal(f.calls[0].signal.aborted,true);finish(latest());await f.h.flush();assert.equal(button(f.h,'commitLatestReuse'),undefined);if(action!=='cancel'){await old.props.onClick();assert.equal(f.calls.length,1);}}finally{f.h.dispose();}}
});
test('pending/blocked guards use live values even for old read and reuse handlers',async()=>{
 for(const key of ['pending','blocked']){const f=fixture({'vcs/latest-commit':async()=>latest()});try{await f.h.flush();await fill(f.h);await readLatest(f);const oldRead=button(f.h,'commitLatestLoad'),oldReuse=button(f.h,'commitLatestReuse');f.h.update({...f.props,[key]:true});await f.h.flush();assert.equal(button(f.h,'commitLatestLoad').props.disabled,true);assert.equal(button(f.h,'commitLatestReuse').props.disabled,true);await oldRead.props.onClick();oldReuse.props.onClick();await f.h.flush();assert.equal(f.calls.length,1);assert.equal(textarea(f.h).props.value,draft().message);}finally{f.h.dispose();}}
});
test('read errors and malformed responses leave draft and candidate untouched',async()=>{
 const patches=[{head:'0'.repeat(40)},{tree:'2'.repeat(64)},{objectFormat:'other'},{ref:'refs/tags/no'},{parents:['3'.repeat(40),'3'.repeat(40)]},{parents:Array(17).fill('3'.repeat(40))},{parents:['0'.repeat(40)]},{author:{...identity(),timestamp:-1}},{author:{...identity(),name:'x'.repeat(1025)}},{committer:{...identity(),timezone:'+1401'}},{message:'\ud800',messageBytes:3},{message:'a\0',messageBytes:2},{message:'x'.repeat(65537),messageBytes:65537},{messageBytes:1},{extra:true}];
 for(const patch of [null,...patches]){const f=fixture({'vcs/latest-commit':async()=>{if(patch===null)throw Error('read failure');return {...latest(),...patch};}});try{await f.h.flush();await fill(f.h);await prepare(f);await ack(f);await readLatest(f);assert.equal(button(f.h,'commitLatestReuse'),undefined);assert.equal(textarea(f.h).props.value,draft().message);assert.equal(input(f.h,'commitAcknowledge').props.checked,true);assert.ok(nodeText(f.h.tree).includes(patch===null?'read failure':'commitLatestInvalid'));}finally{f.h.dispose();}}
});
test('sha256 read snapshots are copied and frozen, stale reuse cannot use replacement response',async()=>{
 let value=latest('Valid\n',64);const f=fixture({'vcs/latest-commit':async()=>value});try{await f.h.flush();await readLatest(f);const old=button(f.h,'commitLatestReuse');value.message='mutated';value.author.name='mutated';assert.ok(!nodeText(f.h.tree).includes('mutated'));value=latest('Replacement\n');await readLatest(f);old.props.onClick();await f.h.flush();assert.equal(textarea(f.h).props.value,'');reuse(f);await f.h.flush();assert.equal(textarea(f.h).props.value,'Replacement\n');}finally{f.h.dispose();}
});
test('confirm pending and unknown reject saved latest handlers',async()=>{
 let finish;const f=fixture({'vcs/latest-commit':async()=>latest(),'vcs/commit-confirm':()=>new Promise(done=>finish=done)});try{await f.h.flush();await fill(f.h);await readLatest(f);const oldRead=button(f.h,'commitLatestLoad'),oldReuse=button(f.h,'commitLatestReuse');await prepare(f);await ack(f);const request=button(f.h,'commitConfirm').props.onClick();await f.h.flush();await oldRead.props.onClick();oldReuse.props.onClick();assert.equal(f.calls.length,3);assert.equal(button(f.h,'commitLatestLoad').props.disabled,true);button(f.h,'commitCancel').props.onClick();await f.h.flush();await oldRead.props.onClick();oldReuse.props.onClick();assert.equal(f.calls.length,3);finish({});await request;await f.h.flush();assert.equal(button(f.h,'commitLatestLoad').props.disabled,true);}finally{f.h.dispose();}
});
