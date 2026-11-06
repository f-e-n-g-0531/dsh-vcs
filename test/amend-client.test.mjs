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
test('blank identities, explicit draft, exact prepare payload, immutable preview and token-only scoped confirm once',async()=>{
 const f=fixture();try{await f.h.flush();assert.equal(f.calls.length,0);assert.equal(input(f.h,'commitCommitter commitemail').props.value,'');await prepare(f);assert.equal(f.calls.length,0);await fill(f.h);await prepare(f);const p=f.calls[0].p;assert.deepEqual(Object.keys(p).sort(),['committer','message','repositoryId','sessionId']);assert.equal(JSON.stringify(p.committer),JSON.stringify(draft().committer));assert.equal(p.message,draft().message);const confirm=button(f.h,'amendConfirm');assert.equal(confirm.props.disabled,true);await confirm.props.onClick();assert.equal(f.calls.length,1);for(const value of ['Explicit Name','Separate Committer','explicit@example.test','1700000000','+0800','refs/heads/main',draft().message])assert.ok(nodeText(f.h.tree).includes(value));assert.ok(!nodeText(f.h.tree).includes('e'.repeat(64)));await ack(f);await Promise.all([confirm.props.onClick(),confirm.props.onClick()]);await f.h.flush();assert.equal(f.calls.length,2);assert.deepEqual(Object.keys(f.calls[1].p).sort(),['repositoryId','sessionId','token']);assert.equal(f.amended,1);assert.equal(findNode(f.h,n=>n.type==='textarea').props.value,'');}finally{f.h.dispose();}
});
test('strict deep preview rejects action, oid width/format, ref, digest, identity, message, expiry and extra scope tampering',async()=>{
 const patches=[{action:'commit'},{previousTree:'0'.repeat(40)},{previousTree:'9'.repeat(64)},{parents:'bad'},{parents:['8'.repeat(40),'8'.repeat(40)]},{parents:['0'.repeat(40)]},{parents:['8'.repeat(64)]},{parents:Array.from({length:17},(_,i)=>(i+1).toString(16).padStart(40,'0'))},{author:{...identity(),extra:true}},{author:{...identity(),timestamp:-1}},{author:{...identity(),timezone:'+1401'}},{author:{...identity(),email:'中'.repeat(342)}},{action:'stage'},{head:'0'.repeat(40)},{tree:'c'.repeat(64)},{commit:{oid:'d'.repeat(64)}},{objectFormat:'sha512'},{ref:'refs/tags/main'},{ref:'refs/heads/../main'},{ref:'refs/heads/main.lock'},{ref:'refs/heads/main\\bad'},{indexDigest:'bad'},{author:{...identity(),name:'<bad>'}},{committer:{...identity(),timestamp:1}},{message:'Changed message'},{token:'bad'},{expiresAt:Date.now()-1},{expiresAt:Date.now()+62000},{repositoryId:'wrong'},{commit:{oid:'d'.repeat(40),body:'secret'}}];
 for(const patch of patches){const f=fixture({'vcs/amend-prepare':async p=>({...candidate(p),...patch})});try{await f.h.flush();await fill(f.h);await prepare(f);assert.equal(button(f.h,'amendConfirm'),undefined,JSON.stringify(patch));assert.ok(nodeText(f.h.tree).includes('amendInvalid'));assert.equal(f.calls.length,1);}finally{f.h.dispose();}}
 const f=fixture({'vcs/amend-prepare':async p=>candidate(p,64)});try{await f.h.flush();await fill(f.h);await prepare(f);assert.ok(button(f.h,'amendConfirm'));}finally{f.h.dispose();}
});
test('editing every field invalidates acknowledgement and candidate without autosend; clear draft is explicit',async()=>{
 const f=fixture();try{await f.h.flush();await fill(f.h);await prepare(f);await ack(f);const stale=button(f.h,'amendConfirm');input(f.h,'commitCommitter commitname').props.onChange({target:{value:'Changed'}});await f.h.flush();await stale.props.onClick();assert.equal(f.calls.length,1);assert.equal(button(f.h,'amendConfirm'),undefined);await prepare(f);assert.equal(input(f.h,'amendAcknowledge').props.checked,false);button(f.h,'amendClearDraft').props.onClick();await f.h.flush();assert.equal(input(f.h,'commitCommitter commitname').props.value,'');assert.equal(findNode(f.h,n=>n.type==='textarea').props.value,'');assert.equal(f.calls.length,2);}finally{f.h.dispose();}
});
test('late prepare ignores cancel, edit, scope changes and unmount without unknown',async()=>{
 for(const action of ['cancel','edit','sessionId','repositoryId','mode','refresh','scope','unmount']){let finish;const f=fixture({'vcs/amend-prepare':()=>new Promise(done=>finish=done)});try{await f.h.flush();await fill(f.h);await prepare(f);const p=f.calls[0].p;if(action==='cancel')button(f.h,'amendCancel').props.onClick();else if(action==='edit')findNode(f.h,n=>n.type==='textarea').props.onChange({target:{value:'edit'}});else if(action==='unmount')f.h.dispose();else f.h.update({...f.props,[action]:action==='refresh'?1:'next'});await f.h.flush();assert.equal(f.calls[0].signal.aborted,true);finish(candidate(p));await f.h.flush();assert.equal(button(f.h,'amendConfirm'),undefined);assert.equal(f.unknowns,0);}finally{f.h.dispose();}}
});
test('confirm cancellation, scope change and unmount latch unknown and discard late success',async()=>{
 for(const action of ['cancel','sessionId','repositoryId','mode','refresh','scope','unmount']){let finish;const f=fixture({'vcs/amend-confirm':()=>new Promise(done=>finish=done)});try{await f.h.flush();await fill(f.h);await prepare(f);await ack(f);const stale=button(f.h,'amendConfirm'),pending=stale.props.onClick();await f.h.flush();if(action==='cancel')button(f.h,'amendCancel').props.onClick();else if(action==='unmount')f.h.dispose();else f.h.update({...f.props,[action]:action==='refresh'?1:'next'});if(action!=='unmount')await f.h.flush();assert.equal(f.calls.at(-1).signal.aborted,true);assert.equal(f.unknowns,1);finish(success(candidate(f.calls[0].p)));await pending;if(action!=='unmount'){await f.h.flush();await stale.props.onClick();}assert.equal(f.amended,0);assert.equal(f.calls.length,2);}finally{f.h.dispose();}}
});
test('every malformed success and confirm rejection is unknown with no retry',async()=>{
 for(const patch of [{head:'f'.repeat(40)},{ref:'refs/heads/other'},{tree:'f'.repeat(40)},{indexDigest:'f'.repeat(64)},{action:'commit'},null]){const f=fixture({'vcs/amend-confirm':async()=>{if(!patch)throw Error('lost');return {...success(candidate()),...patch};}});try{await f.h.flush();await fill(f.h);await prepare(f);await ack(f);const stale=button(f.h,'amendConfirm');await stale.props.onClick();await f.h.flush();assert.equal(f.unknowns,1);assert.equal(f.amended,0);await stale.props.onClick();await button(f.h,'amendPrepare').props.onClick();assert.equal(f.calls.length,2);assert.equal(button(f.h,'amendPrepare').props.disabled,true);}finally{f.h.dispose();}}
});

test('draft bounds reject malformed identities, timestamp, timezone and nonplaintext without RPC',async()=>{
 const changes=[['commitCommitter commitname','<bad>'],['commitCommitter commitemail','x\ny'],['commitCommitter committimestamp','1.5'],['commitCommitter committimestamp','-1'],['commitCommitter committimestamp','9007199254740992'],['commitCommitter committimezone','+1401'],['commitCommitter committimezone','+1260'],['commitCommitter committimezone','UTC'],['commitMessage','\u0000'],['commitMessage','\u202e'],['commitMessage','x'.repeat(65537)],['commitCommitter commitname','中'.repeat(342)]];
 for(const [label,value] of changes){const f=fixture();try{await f.h.flush();await fill(f.h);const n=label==='commitMessage'?findNode(f.h,n=>n.type==='textarea'):input(f.h,label);n.props.onChange({target:{value}});await f.h.flush();await prepare(f);assert.equal(f.calls.length,0,label);assert.ok(nodeText(f.h.tree).includes('amendInvalidDraft'));}finally{f.h.dispose();}}
});

test('expiry burns candidate and stale confirm cannot retry; response snapshot cannot be mutated',async()=>{
 let expire,raw;const f=fixture({'vcs/amend-prepare':async p=>raw=candidate(p)},{setTimeout:fn=>(expire=fn,1),clearTimeout(){}});try{await f.h.flush();await fill(f.h);await prepare(f);await ack(f);raw.author.name='Injected';raw.commit.oid='f'.repeat(40);assert.ok(!nodeText(f.h.tree).includes('Injected'));const stale=button(f.h,'amendConfirm');expire();await f.h.flush();await stale.props.onClick();assert.equal(f.calls.length,1);assert.ok(nodeText(f.h.tree).includes('amendExpired'));}finally{f.h.dispose();}
});

test('root, ordinary and merge snapshots show every retained parent and replacement fields',async()=>{
 for(const count of [0,1,2,16]){const parents=Array.from({length:count},(_,i)=>(i+1).toString(16).padStart(40,'0'));const f=fixture({'vcs/amend-prepare':async p=>({...candidate(p),parents})});try{await f.h.flush();await fill(f.h);await prepare(f);const text=nodeText(f.h.tree);for(const value of [...parents,candidate().head,candidate().previousTree,candidate().tree,candidate().commit.oid,'amendOriginalAuthor','amendNewTree','amendNewCommit'])assert.ok(text.includes(value),value);assert.equal(text.includes('amendRoot'),count===0);}finally{f.h.dispose();}}
});

test('each explicit editable field invalidates saved confirm, including original ack handler',async()=>{
 for(const label of ['commitCommitter commitname','commitCommitter commitemail','commitCommitter committimestamp','commitCommitter committimezone','commitMessage']){const f=fixture();try{await f.h.flush();await fill(f.h);await prepare(f);await ack(f);const stale=button(f.h,'amendConfirm'),oldAck=input(f.h,'amendAcknowledge');const n=label==='commitMessage'?findNode(f.h,n=>n.type==='textarea'):input(f.h,label);n.props.onChange({target:{value:label==='commitMessage'?'Changed message':String(n.props.value)+'x'}});await f.h.flush();oldAck.props.onChange({target:{checked:true}});await stale.props.onClick();assert.equal(f.calls.length,1);assert.equal(button(f.h,'amendConfirm'),undefined);}finally{f.h.dispose();}}
});

const panel=(h,label)=>({get tree(){return findNode(h,n=>n.type==='section'&&n.props['aria-label']===label);},flush:()=>h.flush()});
test('production renders explicit amend only for loaded Git staged status, including empty without selection; success clears selection and rediscovers',async()=>{
 for(const status of ['modified','empty','error','svn']){const calls=[];let prepared;const rpc=async(e,p)=>{calls.push({e,p});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:status==='svn'?'svn':'git',relativePath:'.'}]};if(e==='vcs/status')return status==='error'?{error:'failed',changes:[]}:{changes:status==='empty'?[]:[selectedEntry]};if(e==='vcs/compare')return {...selectedEntry,left:{label:'HEAD',text:'a'},right:{label:'Index',text:'b'}};if(e==='vcs/amend-prepare')return prepared=candidate(p);if(e==='vcs/amend-confirm')return success(prepared);throw Error(e);};const h=production(rpc);try{await h.flush();assert.equal(button(h,'amendPrepare'),undefined);if(status==='svn')continue;await staged(h);assert.equal(!!button(h,'amendPrepare'),status!=='error');if(status==='error')continue;assert.equal(calls.filter(c=>c.e==='vcs/compare').length,0);if(status==='modified')await selectFile(h);const a=panel(h,'amendTitle');await fill(a);await prepare({h:a});await ack({h:a});await button(a,'amendConfirm').props.onClick();await h.flush();assert.equal(calls.filter(c=>c.e==='vcs/repositories').length,2);assert.equal(button(h,'unstagePrepare'),undefined);assert.equal(button(h,'amendConfirm'),undefined);assert.equal(findNode(panel(h,'amendTitle'),n=>n.type==='textarea').props.value,'');assert.deepEqual([...new Set(calls.map(c=>c.e).filter(e=>!['vcs/repositories','vcs/status','vcs/compare','vcs/amend-prepare','vcs/amend-confirm'].includes(e)))],[]);}finally{h.dispose();}}
});

test('production amend shares pending and unknown ref guard with commit and index in both directions, even saved handlers',async()=>{
 for(const otherKind of ['commit','index'])for(const first of ['amend','other']){const calls=[],listeners=new Map();let finish;const index={action:'unstage',path:'f',head:'a'.repeat(40),index:{oid:'b'.repeat(40),mode:'100644'},target:{oid:'c'.repeat(40),mode:'100644'},token:'d'.repeat(64),expiresAt:Date.now()+59000};const rpc=async(e,p)=>{calls.push({e,p});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'}]};if(e==='vcs/status')return {changes:[selectedEntry]};if(e==='vcs/compare')return {...selectedEntry,left:{label:'HEAD',text:'a'},right:{label:'Index',text:'b'}};if(e==='vcs/amend-prepare')return candidate(p);if(e==='vcs/commit-prepare')return {...candidate(p),action:'commit',previousTree:undefined,parents:undefined};if(e==='vcs/index-unstage-prepare')return index;if(e.endsWith('-confirm'))return new Promise(done=>finish=done);throw Error(e);};
 const wrapped=async(e,p)=>{const v=await rpc(e,p);if(e==='vcs/commit-prepare'){delete v.previousTree;delete v.parents;v.author={...p.author};}return v;};const win={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};const h=production(wrapped,{window:win});try{await h.flush();await staged(h);await selectFile(h);const a=panel(h,'amendTitle');await fill(a);await prepare({h:a});await ack({h:a});let other;
 if(otherKind==='commit'){const c=panel(h,'commitTitle');for(const role of ['commitAuthor','commitCommitter'])for(const [key,value] of Object.entries(identity())){input(c,role+' commit'+key).props.onChange({target:{value:String(value)}});await h.flush();}findNode(c,n=>n.type==='textarea').props.onChange({target:{value:'new child'}});await h.flush();button(c,'commitPrepare').props.onClick();await h.flush();input(c,'commitAcknowledge').props.onChange({target:{checked:true}});await h.flush();other=button(c,'commitConfirm');}else{button(h,'unstagePrepare').props.onClick();await h.flush();input(h,'unstageAcknowledge').props.onChange({target:{checked:true}});await h.flush();other=button(h,'unstageConfirm');}
 const amend=button(a,'amendConfirm'),active=first==='amend'?amend:other,blocked=first==='amend'?other:amend;const started=active.props.onClick();await h.flush();await blocked.props.onClick();await h.flush();assert.equal(calls.filter(c=>c.e.endsWith('-confirm')).length,1);finish({});await started;await h.flush();assert.equal(button(h,'amendPrepare').props.disabled,true);await blocked.props.onClick();await h.flush();assert.equal(calls.filter(c=>c.e.endsWith('-confirm')).length,1);listeners.get('focus')?.({target:win});await h.flush();input(h,'gitMode').props.onChange({target:{value:'all'}});await h.flush();await staged(h);assert.equal(button(h,'amendPrepare').props.disabled,true);button(h,'refresh').props.onClick();await h.flush();assert.equal(button(h,'amendPrepare').props.disabled,false);
 }finally{h.dispose();}}
});

test('bilingual explicit amend labels and mock-only opt-in scenario parse without production build',async()=>{
 const locales=JSON.parse(await readFile('src/locales.json','utf8')),source=await readFile('src/AmendPanel.jsx','utf8');for(const [,key] of source.matchAll(/\bt\('([^']+)'\)/g))for(const lang of ['zh','en'])assert.equal(typeof locales[lang][key],'string',key);for(const lang of ['zh','en'])for(const key of ['amendTitle','amendWarning','amendScope','amendDefaults','amendUnknown'])assert.ok(locales[lang][key]);assert.match(locales.en.amendWarning,/HISTORY REWRITE.*not a new child.*append-only.*global external atomicity.*rollback.*force-push/);const browser=await readFile('scripts/amend-browser.jsx','utf8');assert.match(browser,/export async function checkAmend/);assert.doesNotMatch(browser,/latest-commit|fetch\(/);assert.ok(transformSync(browser,{loader:'jsx',format:'esm'}).code);
});
