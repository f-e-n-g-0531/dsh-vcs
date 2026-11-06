import test from 'node:test';
import assert from 'node:assert/strict';
import {transformSync} from 'esbuild';
import {readFileSync} from 'node:fs';
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

// Exercise the real loadPreviewImage limits, decode and URL ownership with memory images.
function fixture(override){
 const calls=[],created=[],revoked=[],blobs=new Map();let rediscovered=0;
 const value=side=>{const [width,height]=side==='left'?[800,400]:[400,600],binary=width+','+height;return {commit:'a',path:side+'.png',mime:'image/png',base64:btoa(binary),bytes:binary.length,width,height};};
 const props={sessionId:'s',repositoryId:'r',commit:'c',parentIndex:0,id:'i',t:k=>k,onRediscover:()=>rediscovered++,rpc:async(e,p,signal)=>{calls.push({e,p,signal});return override?override(p,value):value(p.side);}};
 const environment={Blob,atob,URL:{createObjectURL(blob){const url='blob:memory-'+created.length;created.push(url);blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);blobs.delete(url);}},Image:class {async decode(){const [width,height]=(await blobs.get(this.src).text()).split(',').map(Number);this.naturalWidth=width;this.naturalHeight=height;}}};
 const h=frontendHarness('src/ImageComparison.jsx',props,environment);return {h,props,calls,created,revoked,get rediscovered(){return rediscovered;}};
}
const nodes=h=>renderedNodes(h.tree);
const canvas=h=>findNode(h,n=>n.props?.['data-image-canvas']);
const range=(h,label)=>input(h,label);
const zoom=h=>findNode(h,n=>n.type==='select');
async function click(h,label){button(h,label).props.onClick();await h.flush();}
async function change(h,node,value){node.props.onChange({target:{value}});await h.flush();}
async function open(f){await f.h.flush();assert.equal(f.calls.length,0);await click(f.h,'imageCompare');}
const json=value=>JSON.parse(JSON.stringify(value));

test('two owners load once; repeated mode, opacity, split and zoom changes retain URLs and resources',async()=>{
 const f=fixture();try{await open(f);assert.equal(f.calls.length,2);assert.equal(f.created.length,2);assert.equal(button(f.h,'imageSideBySide').props['aria-pressed'],true);
 for(let i=0;i<3;i++){
  await click(f.h,'imageOverlay');await change(f.h,range(f.h,'imageOpacity'),String(i*50));
  await click(f.h,'imageSwipe');await change(f.h,range(f.h,'imageSplit'),String(i*50));
  for(const scale of ['25','50','100','200','fit'])await change(f.h,zoom(f.h),scale);
  await click(f.h,'imageSideBySide');
 }
 assert.equal(f.calls.length,2);assert.equal(f.created.length,2);assert.equal(f.revoked.length,0);assert.ok(f.calls.every(c=>!c.signal.aborted));
 await click(f.h,'imageCompare');assert.deepEqual(f.revoked,f.created);assert.ok(f.calls.every(c=>c.signal.aborted));assert.equal(nodes(f.h).filter(n=>n.type==='img').length,0);
 }finally{f.h.dispose();}assert.deepEqual(f.revoked,f.created);
});

test('different natural dimensions register top-left with common max canvas and same scale, never stretched',async()=>{
 const f=fixture();try{await open(f);
 const sideImages=nodes(f.h).filter(n=>n.type==='img');assert.equal(sideImages[0].props.style.maxWidth,'100%');assert.equal(sideImages[0].props.style.maxHeight,320);assert.equal(sideImages[1].props.style.maxWidth,'50%');assert.equal(sideImages[1].props.style.maxHeight,480);
 await click(f.h,'imageOverlay');assert.equal(canvas(f.h).props.style.width,'min(100%, 800px, 640px)');assert.equal(canvas(f.h).props.style.aspectRatio,'800/600');
 const images=canvas(f.h).props.children[0];assert.deepEqual(json(images.map(n=>[n.props.style.width,n.props.style.height,n.props.style.left,n.props.style.top])),[['100%','66.66666666666666%',0,0],['50%','100%',0,0]]);
 for(const scale of [25,50,100,200]){await change(f.h,zoom(f.h),String(scale));assert.equal(canvas(f.h).props.style.width,800*scale/100);assert.equal(canvas(f.h).props.style.height,600*scale/100);}
 const region=findNode(f.h,n=>n.type==='div'&&n.props['aria-label']==='imageCompositeViewport · imageViewport');assert.equal(region.props.tabIndex,0);assert.equal(region.props.style.maxHeight,480);assert.equal(region.props.style.overflow,'auto');
 assert.equal(f.calls.length,2);
 }finally{f.h.dispose();}assert.deepEqual(f.revoked,f.created);
});

test('native keyboard ranges expose labeled 0/100 endpoints; malformed percentages clamp or refuse and zoom refuses',async()=>{
 const f=fixture();try{await open(f);for(const [mode,label] of [['imageOverlay','imageOpacity'],['imageSwipe','imageSplit']]){
 await click(f.h,mode);const r=range(f.h,label);assert.equal(r.props.type,'range');assert.equal(r.props.min,'0');assert.equal(r.props.max,'100');assert.equal(r.props.step,'1');assert.equal(r.props.onKeyDown,undefined);
 for(const [raw,expected] of [['0',0],['100',100],['-10',0],['900',100],['NaN',100],['Infinity',100],['',100],['bad',100],[{},100],[null,100]]){await change(f.h,range(f.h,label),raw);assert.equal(range(f.h,label).props.value,expected);}
 }
 await change(f.h,zoom(f.h),'50');for(const bad of ['','bad','Infinity','0','75','201',{},null]){await change(f.h,zoom(f.h),bad);assert.equal(zoom(f.h).props.value,50);}
 await click(f.h,'imageOverlay');await change(f.h,range(f.h,'imageOpacity'),'0');assert.equal(canvas(f.h).props.children[0][1].props.style.opacity,0);await change(f.h,range(f.h,'imageOpacity'),'100');assert.equal(canvas(f.h).props.children[0][1].props.style.opacity,1);
 await click(f.h,'imageSwipe');await change(f.h,range(f.h,'imageSplit'),'0');assert.equal(canvas(f.h).props.children[0][1].props.style.clipPath,'inset(0 100% 0 0)');await change(f.h,range(f.h,'imageSplit'),'100');assert.equal(canvas(f.h).props.children[0][1].props.style.clipPath,'inset(0 0% 0 0)');assert.equal(f.calls.length,2);
 }finally{f.h.dispose();}
});

test('absent/error/loading composite is unavailable; retry stays per-side and does not reload the good owner',async()=>{
 for(const state of ['absent','error','pending']){let finish,failed=true;const f=fixture((p,value)=>{if(p.side==='right')return value(p.side);if(!failed)return value(p.side);if(state==='absent')return {absent:true,path:'left.png'};if(state==='error')throw Error('decode failed');return new Promise(resolve=>finish=()=>resolve(value(p.side)));});try{await open(f);await click(f.h,'imageOverlay');assert.equal(canvas(f.h),undefined);assert.ok(nodeText(f.h.tree).includes('imageCompositeUnavailable'));assert.equal(f.created.length,1);
 if(state==='error'){failed=false;await click(f.h,'retry');assert.ok(canvas(f.h));assert.equal(f.calls.length,3);assert.equal(f.calls.filter(c=>c.p.side==='right').length,1);}
 if(state==='pending'){finish();await f.h.flush();assert.ok(canvas(f.h));assert.equal(f.calls.length,2);}
 }finally{f.h.dispose();}assert.deepEqual([...f.revoked].sort(),[...f.created].sort());}
});

test('scope changes reset presentation and cancel/dispose precisely once; unmount and close discard late RPCs',async()=>{
 for(const key of ['sessionId','repositoryId','commit','parentIndex','base','target','workspace','mode','id']){const f=fixture();try{await open(f);await click(f.h,'imageSwipe');await change(f.h,range(f.h,'imageSplit'),'100');await change(f.h,zoom(f.h),'200');f.h.update({...f.props,[key]:key==='workspace'?true:key==='parentIndex'?1:'next'});await f.h.flush();assert.equal(f.calls.length,4);assert.ok(f.calls.slice(0,2).every(c=>c.signal.aborted));assert.deepEqual(f.revoked,f.created.slice(0,2));assert.equal(button(f.h,'imageSideBySide').props['aria-pressed'],true);assert.equal(zoom(f.h).props.value,'fit');await click(f.h,'imageSwipe');assert.equal(range(f.h,'imageSplit').props.value,50);}finally{f.h.dispose();}assert.deepEqual([...f.revoked].sort(),[...f.created].sort());assert.equal(new Set(f.revoked).size,f.revoked.length);}
 for(const action of ['close','unmount','scope']){const pending=[];const f=fixture((p,value)=>new Promise(resolve=>pending.push(()=>resolve(value(p.side)))));await open(f);const old=f.calls.slice();if(action==='close')await click(f.h,'imageCompare');else if(action==='unmount')f.h.dispose();else {f.h.update({...f.props,id:'next'});await f.h.flush();}assert.ok(old.every(c=>c.signal.aborted));pending.slice(0,2).forEach(finish=>finish());await f.h.flush();assert.equal(f.created.length,0);assert.equal(canvas(f.h),undefined);f.h.dispose();}
});

test('invalid responses retain existing guards, limits, per-side errors and rediscovery',async()=>{
 for(const patch of [{mime:'image/svg+xml'},{base64:'x'.repeat(2796205)},{bytes:2097153},{bytes:0},{width:8193},{width:4001,height:4000},{width:801},{base64:btoa('invalid')},{height:0}]){const f=fixture((p,value)=>p.side==='left'?{...value(p.side),...patch}:value(p.side));try{await open(f);await click(f.h,'imageOverlay');assert.equal(canvas(f.h),undefined);assert.ok(button(f.h,'retry'));assert.equal(f.calls.length,2);}finally{f.h.dispose();}assert.equal(new Set(f.revoked).size,f.revoked.length);assert.equal(f.created.length,f.revoked.length);}
 const f=fixture(p=>{if(p.side==='left')throw Object.assign(Error('expired'),{code:'vcs/rediscover-required'});return {absent:true};});try{await open(f);assert.equal(f.rediscovered,1);}finally{f.h.dispose();}
});
