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
 return {exported,async flush(){for(let round=0;round<40;round++){if(dirty){dirty=false;effects=[];const seen=new Set();tree=render(React.createElement(Root,props),'root',seen);for(const [key,owner] of instances)if(!seen.has(key)){disposeOwner(owner);instances.delete(key);}for(const effect of effects)effect();}await Promise.resolve();await Promise.resolve();await Promise.resolve();}return tree;},
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

const candidate=(p={name:'topic/new'},width=40)=>({action:'lightweight-tag-create',name:p.name,ref:'refs/tags/'+p.name,targetTree:'b'.repeat(width),planId:'c'.repeat(64),head:'a'.repeat(width),currentRef:'refs/heads/main',objectFormat:width===40?'sha1':'sha256',token:'e'.repeat(64),expiresAt:Date.now()+59000});
const success=p=>({name:p.name,ref:p.ref,commit:p.head,currentRef:p.currentRef});
function fixture(overrides={},environment={}){
 const calls=[];let unknowns=0,created=0,rediscovered=0,prepared;
 const props={sessionId:'s',repositoryId:'r',mode:'all',refresh:0,scope:0,t:k=>k,onUnknown:()=>unknowns++,onCreated:()=>created++,onRediscover:()=>rediscovered++,rpc:async(e,p,signal)=>{calls.push({e,p,signal});if(overrides[e])return overrides[e](p,signal);if(e==='vcs/lightweight-tag-prepare')return prepared=candidate(p);if(e==='vcs/lightweight-tag-confirm')return success(prepared);throw Error(e);}};
 const h=frontendHarness('src/LightweightTagCreate.jsx',props,environment);return {h,calls,props,get unknowns(){return unknowns;},get created(){return created;},get rediscovered(){return rediscovered;}};
}
async function fill(h,name='topic/new'){input(h,'lightweightTagName').props.onChange({target:{value:name}});await h.flush();}
async function prepare(f){button(f.h,'lightweightTagPrepare').props.onClick();await f.h.flush();}
async function ack(f){input(f.h,'lightweightTagAcknowledge').props.onChange({target:{checked:true}});await f.h.flush();}
test('exact scoped payload, unchecked acknowledgement, copied fixed preview and token-only one-shot confirm',async()=>{
 const f=fixture();try{await f.h.flush();assert.equal(f.calls.length,0);assert.equal(input(f.h,'lightweightTagName').props.value,'');await prepare(f);assert.equal(f.calls.length,0);await fill(f.h);await prepare(f);assert.deepEqual(Object.keys(f.calls[0].p).sort(),['name','repositoryId','sessionId']);assert.equal(f.calls[0].p.name,'topic/new');const confirm=button(f.h,'lightweightTagConfirm');assert.equal(confirm.props.disabled,true);await confirm.props.onClick();assert.equal(f.calls.length,1);for(const v of ['topic/new','refs/tags/topic/new','refs/heads/main','a'.repeat(40),'HEAD','lightweightTagWarning'])assert.ok(nodeText(f.h.tree).includes(v));assert.ok(!nodeText(f.h.tree).includes('e'.repeat(64)));await ack(f);await Promise.all([confirm.props.onClick(),confirm.props.onClick()]);await f.h.flush();assert.equal(f.created,1);assert.equal(f.calls.length,2);assert.deepEqual(Object.keys(f.calls[1].p).sort(),['repositoryId','sessionId','token']);assert.equal(input(f.h,'lightweightTagName').props.value,'');}finally{f.h.dispose();}
});
test('deep exact previews reject name, action, ref, oid, head, format, scope, token and expiry tampering',async()=>{
 const patches=[{action:'commit'},{name:'other'},{ref:'refs/tags/other'},{targetTree:'0'.repeat(40)},{targetTree:'b'.repeat(64)},{planId:'C'.repeat(64)},{planId:'a'.repeat(63)},{target:{oid:'a'.repeat(40)}},{head:'0'.repeat(40)},{targetTree:'0'.repeat(40)},{head:'a'.repeat(64)},{objectFormat:'sha512'},{currentRef:'refs/tags/main'},{currentRef:'refs/heads/CON'},{currentRef:'refs/heads/a.LOCK'},{token:'E'.repeat(64)},{expiresAt:Date.now()-1},{expiresAt:Date.now()+62000},{sessionId:'wrong'},{extra:true}];
 for(const patch of patches){const f=fixture({'vcs/lightweight-tag-prepare':async p=>({...candidate(p),...patch,...(patch.expiresAt>Date.now()?{expiresAt:Date.now()+62000}:{})})});try{await f.h.flush();await fill(f.h);await prepare(f);assert.equal(button(f.h,'lightweightTagConfirm'),undefined,JSON.stringify(patch));assert.ok(nodeText(f.h.tree).includes('lightweightTagInvalid'));}finally{f.h.dispose();}}
 const f=fixture({'vcs/lightweight-tag-prepare':async p=>candidate(p,64)});try{await f.h.flush();await fill(f.h);await prepare(f);assert.ok(button(f.h,'lightweightTagConfirm'));}finally{f.h.dispose();}
});
test('portable names preserve exact Unicode and byte bounds, rejecting unsafe forms without RPC',async()=>{
 const invalid=['','HEAD','head','@','-x','refs/heads/x','a//b','a/','/a','.x','a/.b','a..b','a@{b','a.lock','a.LOCK','a.','a ','a b','a\\b','a:b','a?b','a*b','a[b','a~b','a^b','a<b','a>b','a"b','a|b','a\n','a\u0000','a\u202e','CON','con.txt','a/LPT9','a/NUL.x','a'.repeat(256),'中'.repeat(86),'\ud800',Array(4).fill('a'.repeat(250)).join('/')];
 for(const name of invalid){const f=fixture();try{await f.h.flush();await fill(f.h,name);await prepare(f);assert.equal(f.calls.length,0,JSON.stringify(name));}finally{f.h.dispose();}}
 for(const name of ['topic/new','中'.repeat(85),'a'.repeat(255),Array(4).fill('a'.repeat(249)).join('/'),'cafe\u0301/é']){const f=fixture();try{await f.h.flush();await fill(f.h,name);await prepare(f);assert.equal(f.calls.length,1,name);assert.equal(f.calls[0].p.name,name);assert.ok(button(f.h,'lightweightTagConfirm'));}finally{f.h.dispose();}}
});
test('edit clears candidate and ack; old confirm and old ack cannot consume replacement token',async()=>{
 let count=0;const f=fixture({'vcs/lightweight-tag-prepare':async p=>({...candidate(p),token:String(++count).repeat(64)})});try{await f.h.flush();await fill(f.h);await prepare(f);await ack(f);const old=button(f.h,'lightweightTagConfirm'),oldAck=input(f.h,'lightweightTagAcknowledge');await fill(f.h,'new/name');await old.props.onClick();await prepare(f);assert.equal(input(f.h,'lightweightTagAcknowledge').props.checked,false);oldAck.props.onChange({target:{checked:true}});await old.props.onClick();assert.equal(f.calls.length,2);await ack(f);await old.props.onClick();assert.equal(f.calls.length,2);await button(f.h,'lightweightTagConfirm').props.onClick();assert.equal(f.calls[2].p.token,'2'.repeat(64));}finally{f.h.dispose();}
});
test('saved prepare and cancel closures ignore name edits including same-value and repeated A -> B -> A drafts',async()=>{
 for(const names of [['topic/A'],['topic/B'],['topic/B','topic/A'],['topic/A','topic/B','topic/A','topic/B','topic/A']]){
  const f=fixture();try{
   await f.h.flush();await fill(f.h,'topic/A');const oldPrepare=button(f.h,'lightweightTagPrepare').props.onClick,oldCancel=button(f.h,'lightweightTagCancel').props.onClick;
   for(const name of names)await fill(f.h,name);
   await oldPrepare();await f.h.flush();assert.equal(f.calls.length,0,'old prepare must not submit an earlier draft');
   await prepare(f);await ack(f);const currentConfirm=button(f.h,'lightweightTagConfirm'),currentAck=input(f.h,'lightweightTagAcknowledge');
   oldCancel();await oldPrepare();await f.h.flush();assert.equal(f.calls.length,1);assert.equal(f.calls[0].p.name,names.at(-1));assert.equal(input(f.h,'lightweightTagAcknowledge').props.checked,true);assert.equal(button(f.h,'lightweightTagConfirm').props.disabled,false);
   await currentConfirm.props.onClick();await f.h.flush();assert.equal(f.created,1);assert.equal(f.calls.length,2);assert.equal(currentAck.props.checked,true);assert.equal(f.unknowns,0);
  }finally{f.h.dispose();}
 }
});
test('current cancel invalidates saved prepare and cancel even with unchanged name and no candidate',async()=>{
 const f=fixture();try{
  await f.h.flush();await fill(f.h);const oldPrepare=button(f.h,'lightweightTagPrepare').props.onClick,oldCancel=button(f.h,'lightweightTagCancel').props.onClick;
  oldCancel();await f.h.flush();await oldPrepare();assert.equal(f.calls.length,0);
  await prepare(f);await ack(f);oldCancel();await f.h.flush();assert.equal(input(f.h,'lightweightTagAcknowledge').props.checked,true);assert.ok(button(f.h,'lightweightTagConfirm'));
  button(f.h,'lightweightTagCancel').props.onClick();await f.h.flush();assert.equal(button(f.h,'lightweightTagConfirm'),undefined);assert.equal(f.unknowns,0);
 }finally{f.h.dispose();}
});
test('late read-only prepare success or error cannot replace a newer busy draft or surface rediscovery',async()=>{
 for(const outcome of ['success','error']){
  const requests=[];const f=fixture({'vcs/lightweight-tag-prepare':(p,signal)=>new Promise((resolve,reject)=>requests.push({p,signal,resolve,reject}))});try{
   await f.h.flush();await fill(f.h,'topic/A');await prepare(f);const oldCancel=button(f.h,'lightweightTagCancel').props.onClick;
   await fill(f.h,'topic/B');await prepare(f);oldCancel();await f.h.flush();assert.equal(requests[0].signal.aborted,true);assert.equal(requests[1].signal.aborted,false);
   if(outcome==='success')requests[0].resolve(candidate(requests[0].p));else requests[0].reject(Object.assign(Error('stale prepare'),{code:'vcs/rediscover-required'}));
   await f.h.flush();assert.equal(button(f.h,'lightweightTagConfirm'),undefined);assert.equal(button(f.h,'lightweightTagPrepare').props.disabled,true);assert.ok(!nodeText(f.h.tree).includes('stale prepare'));assert.equal(f.rediscovered,0);assert.equal(f.unknowns,0);
   requests[1].resolve(candidate(requests[1].p));await f.h.flush();assert.ok(nodeText(f.h.tree).includes('refs/tags/topic/B'));assert.equal(button(f.h,'lightweightTagPrepare').props.disabled,false);
  }finally{f.h.dispose();}
 }
});
test('late prepare responses while blocked or pending are read-only and discarded without unknown',async()=>{
 for(const gate of ['blocked','pending'])for(const outcome of ['success','error']){
  let resolve,reject;const f=fixture({'vcs/lightweight-tag-prepare':()=>new Promise((yes,no)=>{resolve=yes;reject=no;})});try{
   await f.h.flush();await fill(f.h);await prepare(f);f.h.update({...f.props,[gate]:true});await f.h.flush();
   if(outcome==='success')resolve(candidate(f.calls[0].p));else reject(Object.assign(Error('late blocked read'),{code:'vcs/rediscover-required'}));
   await f.h.flush();f.h.update(f.props);await f.h.flush();assert.equal(button(f.h,'lightweightTagConfirm'),undefined);assert.equal(f.unknowns,0);assert.equal(f.rediscovered,0);assert.ok(!nodeText(f.h.tree).includes('late blocked read'));assert.equal(button(f.h,'lightweightTagPrepare').props.disabled,false);
  }finally{f.h.dispose();}
 }
});
test('prepare cancellation, edit, remount scopes and unmount ignore late response without unknown',async()=>{
 for(const action of ['cancel','edit','sessionId','repositoryId','mode','refresh','scope','unmount']){let finish;const f=fixture({'vcs/lightweight-tag-prepare':()=>new Promise(done=>finish=done)});try{await f.h.flush();await fill(f.h);await prepare(f);if(action==='cancel')button(f.h,'lightweightTagCancel').props.onClick();else if(action==='edit')await fill(f.h,'other');else if(action==='unmount')f.h.dispose();else f.h.update({...f.props,[action]:'next'});await f.h.flush();assert.equal(f.calls[0].signal.aborted,true);finish(candidate(f.calls[0].p));await f.h.flush();assert.equal(button(f.h,'lightweightTagConfirm'),undefined);assert.equal(f.unknowns,0);}finally{f.h.dispose();}}
});
test('confirm cancellation and every remount scope latch unknown and discard late success',async()=>{
 for(const action of ['cancel','sessionId','repositoryId','mode','refresh','scope','unmount']){let finish;const f=fixture({'vcs/lightweight-tag-confirm':()=>new Promise(done=>finish=done)});try{await f.h.flush();await fill(f.h);await prepare(f);await ack(f);const stale=button(f.h,'lightweightTagConfirm'),pending=stale.props.onClick();await f.h.flush();if(action==='cancel')button(f.h,'lightweightTagCancel').props.onClick();else if(action==='unmount')f.h.dispose();else f.h.update({...f.props,[action]:'next'});if(action!=='unmount')await f.h.flush();assert.equal(f.calls[1].signal.aborted,true);assert.equal(f.unknowns,1);finish(success(candidate(f.calls[0].p)));await pending;assert.equal(f.created,0);await stale.props.onClick();assert.equal(f.calls.length,2);}finally{f.h.dispose();}}
});
test('malformed success or rejection latches unknown and prevents retry',async()=>{
 for(const patch of [{name:'wrong'},{ref:'refs/heads/wrong'},{commit:'f'.repeat(40)},{currentRef:'refs/heads/wrong'},{extra:true},null]){const f=fixture({'vcs/lightweight-tag-confirm':async()=>{if(!patch)throw Error('lost');return {...success(candidate()),...patch};}});try{await f.h.flush();await fill(f.h);await prepare(f);await ack(f);const old=button(f.h,'lightweightTagConfirm');await old.props.onClick();await f.h.flush();assert.equal(f.unknowns,1);assert.equal(f.created,0);await old.props.onClick();await prepare(f);assert.equal(f.calls.length,2);assert.equal(button(f.h,'lightweightTagPrepare').props.disabled,true);}finally{f.h.dispose();}}
});
test('expiry burns fixed candidate and raw target mutation cannot alter copied snapshot',async()=>{
 let expire,raw;const f=fixture({'vcs/lightweight-tag-prepare':async p=>raw=candidate(p)},{setTimeout:fn=>(expire=fn,1),clearTimeout(){}});try{await f.h.flush();await fill(f.h);await prepare(f);await ack(f);raw.targetTree='f'.repeat(40);raw.name='injected';assert.ok(!nodeText(f.h.tree).includes('injected'));const stale=button(f.h,'lightweightTagConfirm');expire();await f.h.flush();await stale.props.onClick();assert.equal(f.calls.length,1);assert.ok(nodeText(f.h.tree).includes('lightweightTagExpired'));}finally{f.h.dispose();}
});
test('prepare failure permits explicit retry only and confirm checks wall-clock expiry even before timer',async()=>{
 let attempts=0,now=Date.now();const clock=class extends Date{static now(){return now;}};const f=fixture({'vcs/lightweight-tag-prepare':async p=>{if(++attempts===1)throw Error('read failed');return {...candidate(p),expiresAt:now+1000};}},{Date:clock,setTimeout:()=>1,clearTimeout(){}});try{await f.h.flush();await fill(f.h);await prepare(f);assert.equal(f.calls.length,1);assert.equal(f.unknowns,0);assert.equal(button(f.h,'lightweightTagConfirm'),undefined);await prepare(f);await ack(f);const stale=button(f.h,'lightweightTagConfirm');now+=1001;await stale.props.onClick();await f.h.flush();assert.equal(f.calls.length,2);assert.equal(button(f.h,'lightweightTagConfirm'),undefined);assert.ok(nodeText(f.h.tree).includes('lightweightTagExpired'));}finally{f.h.dispose();}
});
test('unsafe session or repository scopes and blocked/pending reject saved handlers',async()=>{
 for(const patch of [{sessionId:''},{repositoryId:''},{sessionId:'bad\u0000'},{repositoryId:null},{blocked:true},{pending:true}]){const f=fixture();try{await f.h.flush();await fill(f.h);await prepare(f);await ack(f);const old=button(f.h,'lightweightTagConfirm');f.h.update({...f.props,...patch});await f.h.flush();await old.props.onClick();await prepare(f);assert.equal(f.calls.length,1);}finally{f.h.dispose();}}
});

const panel=(h,label)=>({get tree(){return findNode(h,n=>n.type==='section'&&n.props['aria-label']===label);},flush:()=>h.flush()});
const branchCandidate=p=>({action:'branch-create',name:p.name,ref:'refs/heads/'+p.name,target:{oid:'a'.repeat(40)},head:'a'.repeat(40),currentRef:'refs/heads/main',objectFormat:'sha1',token:'b'.repeat(64),expiresAt:Date.now()+59000});
const annotatedCandidate=p=>({action:'tag-create',name:p.name,ref:'refs/tags/'+p.name,object:{oid:'d'.repeat(40)},head:'a'.repeat(40),targetTree:'c'.repeat(40),tagger:{...p.tagger},message:p.message,messageBytes:Buffer.byteLength(p.message),currentRef:'refs/heads/main',objectFormat:'sha1',planId:'f'.repeat(64),token:'e'.repeat(64),expiresAt:Date.now()+59000});
async function prepareSibling(h,kind){const prefix=kind==='branch'?'branchCreate':'tagCreate',c=panel(h,prefix+'Title');input(c,prefix+'Name').props.onChange({target:{value:'other/tag'}});await h.flush();if(kind==='annotated'){for(const [key,value]of Object.entries(identity())){input(c,'tagCreateTagger commit'+key).props.onChange({target:{value:String(value)}});await h.flush();}findNode(c,n=>n.type==='textarea').props.onChange({target:{value:'explicit message'}});await h.flush();}button(c,prefix+'Prepare').props.onClick();await h.flush();input(c,prefix+'Acknowledge').props.onChange({target:{checked:true}});await h.flush();return button(c,prefix+'Confirm');}
const identity=()=>({name:'Explicit',email:'explicit@example.test',timestamp:1700000000,timezone:'+0800'});
const commitCandidate=(p,amend=false)=>({action:amend?'amend':'commit',head:'a'.repeat(40),ref:'refs/heads/main',objectFormat:'sha1',indexDigest:'b'.repeat(64),tree:'c'.repeat(40),commit:{oid:'d'.repeat(40)},author:amend?identity():{...p.author},committer:{...p.committer},message:p.message,token:'e'.repeat(64),expiresAt:Date.now()+59000,...(amend?{previousTree:'9'.repeat(40),parents:[]}:{} )});
async function prepareCommit(h,kind){const c=panel(h,kind==='amend'?'amendTitle':'commitTitle');for(const role of kind==='amend'?['commitCommitter']:['commitAuthor','commitCommitter'])for(const [key,value]of Object.entries(identity())){input(c,role+' commit'+key).props.onChange({target:{value:String(value)}});await h.flush();}findNode(c,n=>n.type==='textarea').props.onChange({target:{value:'explicit message'}});await h.flush();button(c,kind+'Prepare').props.onClick();await h.flush();input(c,kind+'Acknowledge').props.onChange({target:{checked:true}});await h.flush();return button(c,kind+'Confirm');}
test('production lightweight-tag available in any workspace Git mode without status changes, not SVN/review/scanning; exact success rediscovers without switch',async()=>{
 for(const status of ['modified','empty','error','svn']){const calls=[];let prepared;const rpc=async(e,p)=>{calls.push({e,p});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:status==='svn'?'svn':'git',relativePath:'.'}]};if(e==='vcs/status')return status==='error'?{error:'failed',changes:[]}:{changes:status==='empty'?[]:[selectedEntry]};if(e==='vcs/compare')return {...selectedEntry,left:{label:'HEAD',text:'a'},right:{label:'Index',text:'b'}};if(e==='vcs/lightweight-tag-prepare')return prepared=candidate(p);if(e==='vcs/lightweight-tag-confirm')return success(prepared);if(e==='vcs/history')return {commits:[],branches:[]};throw Error(e);};const h=production(rpc);try{await h.flush();assert.equal(!!button(h,'lightweightTagPrepare'),status!=='svn');if(status==='svn')continue;for(const mode of ['unstaged','staged','all']){input(h,'gitMode').props.onChange({target:{value:mode}});await h.flush();assert.ok(button(h,'lightweightTagPrepare'));}const b=panel(h,'lightweightTagTitle');await fill(b);await prepare({h:b});await ack({h:b});await button(b,'lightweightTagConfirm').props.onClick();await h.flush();assert.equal(calls.filter(c=>c.e==='vcs/repositories').length,2);assert.equal(button(h,'lightweightTagConfirm'),undefined);assert.equal(input(h,'lightweightTagName').props.value,'');assert.ok(!calls.some(c=>/branch-switch/.test(c.e)));}finally{h.dispose();}}
 const calls=[];let finish;const h=production(async(e,p)=>{calls.push({e,p});if(e==='vcs/repositories')return new Promise(done=>finish=done);throw Error(e);});try{await h.flush();assert.equal(button(h,'lightweightTagPrepare'),undefined);finish({cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'}]});await h.flush();assert.ok(button(h,'lightweightTagPrepare'));button(h,'history').props.onClick();await h.flush();assert.equal(button(h,'lightweightTagPrepare'),undefined);}finally{h.dispose();}
});
test('production lightweight-tag shares pending/unknown refs with annotated tag, branch, commit, amend and index, both directions including saved handlers',async()=>{
 for(const otherKind of ['annotated','branch','commit','amend','index'])for(const first of ['branch','other']){const calls=[],listeners=new Map();let finish;const index={action:'unstage',path:'f',head:'a'.repeat(40),index:{oid:'b'.repeat(40),mode:'100644'},target:{oid:'c'.repeat(40),mode:'100644'},token:'d'.repeat(64),expiresAt:Date.now()+59000};const rpc=async(e,p)=>{calls.push({e,p});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'}]};if(e==='vcs/status')return {changes:[selectedEntry]};if(e==='vcs/compare')return {...selectedEntry,left:{label:'HEAD',text:'a'},right:{label:'Index',text:'b'}};if(e==='vcs/lightweight-tag-prepare')return candidate(p);if(e==='vcs/branch-create-prepare')return branchCandidate(p);if(e==='vcs/tag-create-prepare')return annotatedCandidate(p);if(e==='vcs/amend-prepare')return commitCandidate(p,true);if(e==='vcs/commit-prepare')return commitCandidate(p);if(e==='vcs/index-unstage-prepare')return index;if(e.endsWith('-confirm'))return new Promise(done=>finish=done);throw Error(e);};
 const win={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};const h=production(rpc,{window:win});try{await h.flush();await staged(h);await selectFile(h);const b=panel(h,'lightweightTagTitle');await fill(b);await prepare({h:b});await ack({h:b});let other;if(otherKind==='index'){button(h,'unstagePrepare').props.onClick();await h.flush();input(h,'unstageAcknowledge').props.onChange({target:{checked:true}});await h.flush();other=button(h,'unstageConfirm');}else if(otherKind==='annotated'||otherKind==='branch')other=await prepareSibling(h,otherKind);else other=await prepareCommit(h,otherKind);
 const branch=button(b,'lightweightTagConfirm'),active=first==='branch'?branch:other,blocked=first==='branch'?other:branch;const started=active.props.onClick();await h.flush();await blocked.props.onClick();await h.flush();assert.equal(calls.filter(c=>c.e.endsWith('-confirm')).length,1);finish({});await started;await h.flush();assert.equal(button(h,'lightweightTagPrepare').props.disabled,true);await blocked.props.onClick();assert.equal(calls.filter(c=>c.e.endsWith('-confirm')).length,1);listeners.get('focus')?.({target:win});await h.flush();input(h,'gitMode').props.onChange({target:{value:'all'}});await h.flush();await staged(h);assert.equal(button(h,'lightweightTagPrepare').props.disabled,true);button(h,'refresh').props.onClick();await h.flush();assert.equal(button(h,'lightweightTagPrepare').props.disabled,false);
 }finally{h.dispose();}}
});
test('bilingual safety labels and opt-in mock browser export parse without build/browser',async()=>{
 const locales=JSON.parse(await readFile('src/locales.json','utf8')),source=await readFile('src/LightweightTagCreate.jsx','utf8');for(const [,key]of source.matchAll(/\bt\('([^']+)'\)/g))for(const lang of ['zh','en'])assert.equal(typeof locales[lang][key],'string',key);assert.match(locales.en.lightweightTagBounds,/1000.*255.*61/);assert.match(locales.en.lightweightTagScope,/Strict configuration.*overwrite.*checkout/);assert.match(locales.en.lightweightTagUnknown,/unknown.*retry.*refs and HEAD/);assert.match(locales.en.lightweightTagScope,/directly.*commit.*no tag object, tagger or message/);assert.notEqual(locales.en.lightweightTagTitle,locales.en.tagCreateTitle);const browser=await readFile('scripts/lightweight-tag-browser.jsx','utf8');assert.match(browser,/export async function checkLightweightTagCreate/);assert.doesNotMatch(browser,/fetch\(|branch-switch-confirm/);assert.ok(transformSync(browser,{loader:'jsx',format:'esm'}).code);
});

test('capture owns exact frozen scalar snapshot, TTL edges and old expiry cannot consume newer candidate',async()=>{
 const timers=[],f=fixture({},{setTimeout:fn=>(timers.push(fn),timers.length),clearTimeout(){}});try{await f.h.flush();const capture=f.h.exported.captureLightweightTagCreatePreview,submitted={name:'topic/new'},raw=candidate(submitted),snapshot=capture(raw,submitted);assert.ok(Object.isFrozen(snapshot));assert.equal(Object.keys(snapshot).length,10);raw.head='f'.repeat(40);raw.targetTree='9'.repeat(40);raw.planId='0'.repeat(64);assert.equal(snapshot.head,'a'.repeat(40));assert.equal(snapshot.targetTree,'b'.repeat(40));assert.equal(snapshot.planId,'c'.repeat(64));const now=Date.now();for(const delta of [0,-1,61001])assert.equal(capture({...candidate(submitted),expiresAt:now+delta},submitted,now),null);for(const delta of [1,61000])assert.ok(capture({...candidate(submitted),expiresAt:now+delta},submitted,now));await fill(f.h);await prepare(f);const oldExpire=timers.at(-1);await fill(f.h,'new/tag');await prepare(f);oldExpire();await f.h.flush();assert.ok(button(f.h,'lightweightTagConfirm'));assert.ok(nodeText(f.h.tree).includes('new/tag'));assert.equal(renderedNodes(f.h.tree).filter(n=>n.type==='input').length,2);assert.equal(findNode(f.h,n=>n.type==='textarea'),undefined);}finally{f.h.dispose();}
});
test('production confirmation mutex has twelve unique endpoints including lightweight confirm',async()=>{const source=await readFile('src/client.jsx','utf8'),line=source.split('\n').find(line=>line.includes('const mutation=')),list=line.match(new RegExp('vcs/[a-z-]+','g'));assert.equal(list.length,12);assert.equal(new Set(list).size,12);assert.ok(list.includes('vcs/lightweight-tag-confirm'));});
