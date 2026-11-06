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

const snapshot=()=>({action:'stage',path:'folder/中文.txt',head:'a'.repeat(40),index:{oid:'b'.repeat(40),mode:'100644'},target:{oid:'c'.repeat(40),mode:'100644'},token:'d'.repeat(64),expiresAt:Date.now()+59000});
const result=p=>({path:p.path,head:p.head,index:p.target});
function fixture(overrides={},environment={}){
 const calls=[];let refreshes=0,unknowns=0;const prepared=snapshot();
 const handlers={'vcs/index-stage-prepare':async()=>prepared,'vcs/index-stage-confirm':async()=>result(prepared),...overrides};
 const props={sessionId:'s',repositoryId:'r',id:'opaque-id',mode:'unstaged',refresh:0,t:k=>k,onStaged:()=>{refreshes++;},onUnknown:()=>{unknowns++;},rpc:(e,p,signal)=>{calls.push({e,p,signal});return handlers[e](p,signal);}};
 const h=frontendHarness('src/IndexStage.jsx',props,environment);return {h,calls,props,prepared,get refreshes(){return refreshes;},get unknowns(){return unknowns;}};
}
async function preview(f){button(f.h,'stagePrepare').props.onClick();await f.h.flush();}
async function acknowledge(f){input(f.h,'stageAcknowledge').props.onChange({target:{checked:true}});await f.h.flush();}

test('independent preview, explicit checkbox, cancel clears token and only opaque identity/token go outbound',async()=>{
 const f=fixture();try{await f.h.flush();assert.equal(f.calls.length,0);await preview(f);
 assert.deepEqual(Object.keys(f.calls[0].p).sort(),['id','repositoryId','sessionId']);assert.equal(f.calls[0].p.id,'opaque-id');
 const text=nodeText(f.h.tree);for(const value of [f.prepared.path,f.prepared.head,f.prepared.index.oid,f.prepared.target.oid,'100644'])assert.ok(text.includes(value));assert.equal(text.includes(f.prepared.token),false);
 const stale=button(f.h,'stageConfirm');assert.equal(stale.props.disabled,true);await stale.props.onClick();assert.equal(f.calls.length,1);
 await acknowledge(f);button(f.h,'stageCancel').props.onClick();await f.h.flush();await stale.props.onClick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].signal.aborted,true);assert.equal(button(f.h,'stageConfirm'),undefined);
 await preview(f);assert.equal(input(f.h,'stageAcknowledge').props.checked,false);await acknowledge(f);const confirm=button(f.h,'stageConfirm');await Promise.all([confirm.props.onClick(),confirm.props.onClick()]);await f.h.flush();
 const writes=f.calls.filter(c=>c.e==='vcs/index-stage-confirm');assert.equal(writes.length,1);assert.deepEqual(Object.keys(writes[0].p).sort(),['repositoryId','sessionId','token']);assert.equal(writes[0].p.token,f.prepared.token);assert.equal(f.refreshes,1);
 }finally{f.h.dispose();}
});

test('invalid previews and wrong mode never enable a write',async()=>{
 for(const patch of [{action:'unstage'},{path:''},{token:'bad'},{head:'bad'},{index:{oid:'b'.repeat(40),mode:'120000'}},{target:{oid:'c'.repeat(64),mode:'100644'}},{expiresAt:Date.now()-1},{expiresAt:Date.now()+120000}]){
  const f=fixture({'vcs/index-stage-prepare':async()=>({...snapshot(),...patch})});try{await f.h.flush();await preview(f);assert.equal(button(f.h,'stageConfirm'),undefined);assert.match(nodeText(f.h.tree),/stageInvalid/);assert.equal(f.calls.length,1);}finally{f.h.dispose();}
 }
 const f=fixture();try{f.h.update({...f.props,mode:'staged'});await f.h.flush();await button(f.h,'stagePrepare').props.onClick();assert.equal(f.calls.length,0);}finally{f.h.dispose();}
});

test('cancel and close abort pending prepare and discard late results',async()=>{
 for(const label of ['stageCancel','stageClose']){let finish;const f=fixture({'vcs/index-stage-prepare':()=>new Promise(done=>{finish=done;})});try{await f.h.flush();await preview(f);button(f.h,label).props.onClick();await f.h.flush();assert.equal(f.calls[0].signal.aborted,true);finish(f.prepared);await f.h.flush();assert.equal(button(f.h,'stageConfirm'),undefined);assert.equal(f.refreshes,0);}finally{f.h.dispose();}}
});

test('every scope dimension aborts pending prepare and ignores stale confirmation callbacks',async()=>{
 for(const patch of [{sessionId:'next'},{repositoryId:'next'},{id:'next'},{refresh:1},{mode:'all'}]){
 let finish;const f=fixture({'vcs/index-stage-prepare':()=>new Promise(done=>{finish=done;})});try{await f.h.flush();await preview(f);f.h.update({...f.props,...patch});await f.h.flush();assert.equal(f.calls[0].signal.aborted,true);finish(f.prepared);await f.h.flush();assert.equal(button(f.h,'stageConfirm'),undefined);}finally{f.h.dispose();}
 let settle;const g=fixture({'vcs/index-stage-confirm':()=>new Promise(done=>{settle=done;})});try{await g.h.flush();await preview(g);await acknowledge(g);const stale=button(g.h,'stageConfirm');const pending=stale.props.onClick();await g.h.flush();g.h.update({...g.props,...patch});await g.h.flush();assert.equal(g.calls.at(-1).signal.aborted,true);assert.equal(g.unknowns,1);settle(result(g.prepared));await pending;await g.h.flush();await stale.props.onClick();assert.equal(g.refreshes,0);assert.equal(g.calls.filter(c=>c.e==='vcs/index-stage-confirm').length,1);}finally{g.h.dispose();}
 }
});

test('all confirm failures including invalid result are unknown with no retry until explicit refresh',async()=>{
 for(const code of ['vcs/busy','vcs/rediscover-required','vcs/confirmation-invalid',undefined,'invalid-result']){
 const f=fixture({'vcs/index-stage-confirm':async()=>{if(code==='invalid-result')return {...result(snapshot()),head:'f'.repeat(40)};throw Object.assign(Error('lost response'),{code});}});
 try{await f.h.flush();await preview(f);await acknowledge(f);const stale=button(f.h,'stageConfirm');await stale.props.onClick();await f.h.flush();assert.equal(f.refreshes,0);assert.equal(f.unknowns,1);assert.match(nodeText(f.h.tree),/stageUnknown/);assert.equal(button(f.h,'stagePrepare').props.disabled,true);await stale.props.onClick();await button(f.h,'stagePrepare').props.onClick();assert.equal(f.calls.length,2);button(f.h,'stageRecover').props.onClick();assert.equal(f.refreshes,1);}finally{f.h.dispose();}
 }
});

test('deadline timer and retained handlers never send expired token; prepare failure never writes',async()=>{
 const timers=new Map();let n=0;const f=fixture({}, {setTimeout:(fn,delay)=>{timers.set(++n,{fn,delay});return n;},clearTimeout:id=>timers.delete(id)});
 try{await f.h.flush();await preview(f);await acknowledge(f);assert.equal(timers.size,1);const stale=button(f.h,'stageConfirm');[...timers.values()][0].fn();await f.h.flush();await stale.props.onClick();assert.equal(f.calls.length,1);assert.match(nodeText(f.h.tree),/stageExpired/);assert.equal(timers.size,0);
 await preview(f);await acknowledge(f);f.prepared.expiresAt=Date.now()-1;await button(f.h,'stageConfirm').props.onClick();await f.h.flush();assert.equal(f.calls.length,2);
 }finally{f.h.dispose();}
 const g=fixture({'vcs/index-stage-prepare':async()=>{throw Error('Unsupported MM');}});try{await g.h.flush();await preview(g);assert.match(nodeText(g.h.tree),/Unsupported MM/);assert.equal(button(g.h,'stageConfirm'),undefined);assert.equal(g.refreshes,0);}finally{g.h.dispose();}
});

test('cancelling pending confirmation aborts but reports unknown and ignores late success',async()=>{
 let finish;const f=fixture({'vcs/index-stage-confirm':()=>new Promise(done=>{finish=done;})});try{await f.h.flush();await preview(f);await acknowledge(f);const pending=button(f.h,'stageConfirm').props.onClick();await f.h.flush();button(f.h,'stageClose').props.onClick();await f.h.flush();assert.equal(f.calls.at(-1).signal.aborted,true);assert.match(nodeText(f.h.tree),/stageUnknown/);finish(result(f.prepared));await pending;await f.h.flush();assert.equal(f.refreshes,0);assert.equal(f.unknowns,1);}finally{f.h.dispose();}
});

test('production unstaged modified selection only; success rediscovery clears selection',async()=>{
 for(const change of [{status:'modified',indexStatus:' ',worktreeStatus:'M'},{status:'modified',indexStatus:'M',worktreeStatus:'M'},{status:'added',indexStatus:'A',worktreeStatus:' '},{status:'modified',indexStatus:' ',worktreeStatus:'M',submodule:{}},{status:'modified',indexStatus:' ',worktreeStatus:'M',oldPath:'old'}]){
 const calls=[],p=snapshot();const entry={id:'f',path:'f',...change};
 const rpc=async(e,args)=>{calls.push({e,args});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'}]};if(e==='vcs/status')return {changes:[entry]};if(e==='vcs/compare')return {...entry,left:{label:'HEAD',text:'a'},right:{label:'Index',text:'b'}};if(e==='vcs/index-stage-prepare')return p;if(e==='vcs/index-stage-confirm')return result(p);throw Error('unexpected '+e);};
 const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})});
 try{await h.flush();assert.equal(button(h,'stagePrepare'),undefined);input(h,'gitMode').props.onChange({target:{value:'unstaged'}});await h.flush();findNode(h,n=>n.type==='button'&&n.props['data-vcs-change']).props.onClick();await h.flush();const allowed=change.indexStatus===' '&&change.worktreeStatus==='M'&&!change.submodule&&!change.oldPath;assert.equal(!!button(h,'stagePrepare'),allowed);
 if(allowed){await preview({h});await acknowledge({h});await button(h,'stageConfirm').props.onClick();await h.flush();assert.equal(calls.filter(c=>c.e==='vcs/repositories').length,2);assert.equal(button(h,'stagePrepare'),undefined);assert.equal(calls.filter(c=>c.e==='vcs/status').length,3);}
 }finally{h.dispose();}
 }
});

test('production unknown latch survives mode/selection and focus refresh until explicit header refresh',async()=>{
 const calls=[],listeners=new Map(),p=snapshot(),entry={id:'f',path:'f',status:'modified',indexStatus:' ',worktreeStatus:'M'};
 const rpc=async(e,args)=>{calls.push({e,args});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'}]};if(e==='vcs/status')return {changes:[entry]};if(e==='vcs/compare')return {...entry,left:{label:'HEAD',text:'a'},right:{label:'Index',text:'b'}};if(e==='vcs/index-stage-prepare')return p;if(e==='vcs/index-stage-confirm')throw Error('lost response');throw Error('unexpected '+e);};
 const win={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)};
 const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})},{window:win});
 const select=async()=>{findNode(h,n=>n.type==='button'&&n.props['data-vcs-change']).props.onClick();await h.flush();};
 try{await h.flush();input(h,'gitMode').props.onChange({target:{value:'unstaged'}});await h.flush();await select();await preview({h});await acknowledge({h});await button(h,'stageConfirm').props.onClick();await h.flush();assert.equal(calls.filter(c=>c.e==='vcs/repositories').length,1);
 listeners.get('focus')({target:win});await h.flush();assert.equal(button(h,'stagePrepare').props.disabled,true);
 for(const mode of ['all','unstaged']){input(h,'gitMode').props.onChange({target:{value:mode}});await h.flush();}await select();assert.equal(button(h,'stagePrepare').props.disabled,true);await button(h,'stagePrepare').props.onClick();assert.equal(calls.filter(c=>c.e==='vcs/index-stage-prepare').length,1);
 button(h,'refresh').props.onClick();await h.flush();await select();assert.equal(button(h,'stagePrepare').props.disabled,false);assert.equal(button(h,'stageConfirm'),undefined);
 }finally{h.dispose();}
});

test('refreshing another repository cannot clear an unknown outcome latch',async()=>{
 const p=snapshot(),entry={id:'f',path:'f',status:'modified',indexStatus:' ',worktreeStatus:'M'};
 const rpc=async(e,args)=>{if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'},{id:'other',type:'git',relativePath:'other'}]};if(e==='vcs/status')return {changes:[entry]};if(e==='vcs/compare')return {...entry,left:{label:'HEAD',text:'a'},right:{label:'Index',text:'b'}};if(e==='vcs/index-stage-prepare')return p;if(e==='vcs/index-stage-confirm')throw Error('lost');throw Error(e);};
 const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})});
 const select=async()=>{findNode(h,n=>n.type==='button'&&n.props['data-vcs-change']).props.onClick();await h.flush();};
 try{await h.flush();input(h,'gitMode').props.onChange({target:{value:'unstaged'}});await h.flush();await select();await preview({h});await acknowledge({h});await button(h,'stageConfirm').props.onClick();await h.flush();input(h,'repositories').props.onChange({target:{value:'other'}});await h.flush();button(h,'refresh').props.onClick();await h.flush();input(h,'repositories').props.onChange({target:{value:'r'}});await h.flush();await select();assert.equal(button(h,'stagePrepare').props.disabled,true);}finally{h.dispose();}
});
test('stage and unstage share the same repository unknown latch in both directions',async()=>{
 for(const first of ['stage','unstage']){
  const calls=[],p=snapshot();let currentMode='all';
  const entry=()=>({id:'f',path:'f',status:'modified',indexStatus:currentMode==='staged'?'M':' ',worktreeStatus:currentMode==='staged'?' ':'M'});
  const rpc=async(e,args)=>{calls.push({e,args});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'}]};if(e==='vcs/status'){currentMode=args.mode;return {changes:[entry()]};}if(e==='vcs/compare')return {...entry(),left:{label:'Index',text:'a'},right:{label:'Worktree',text:'b'}};if(e.endsWith('-prepare'))return {...p,action:first};if(e.endsWith('-confirm'))throw Error('lost response');throw Error(e);};
  const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})});
  const select=async()=>{findNode(h,n=>n.type==='button'&&n.props['data-vcs-change']).props.onClick();await h.flush();};
  const mode=async value=>{input(h,'gitMode').props.onChange({target:{value}});await h.flush();await select();};
  try{await h.flush();await mode(first==='stage'?'unstaged':'staged');button(h,first+'Prepare').props.onClick();await h.flush();input(h,first+'Acknowledge').props.onChange({target:{checked:true}});await h.flush();await button(h,first+'Confirm').props.onClick();await h.flush();
   const other=first==='stage'?'unstage':'stage';await mode(other==='stage'?'unstaged':'staged');assert.equal(button(h,other+'Prepare').props.disabled,true);await button(h,other+'Prepare').props.onClick();assert.equal(calls.filter(c=>c.e.endsWith('-prepare')).length,1);
   button(h,'refresh').props.onClick();await h.flush();await select();assert.equal(button(h,other+'Prepare').props.disabled,false);
  }finally{h.dispose();}
 }
});

test('UI and dedicated browser scenario compile in memory with complete bilingual labels',async()=>{
 for(const entry of ['src/IndexStage.jsx','src/client.jsx','scripts/index-stage-browser.jsx']){const result=await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'esm',external:['react','react-dom/client','react-dom'],loader:{'.css':'text'}});assert.ok(result.outputFiles[0].contents.length);}
 const locales=JSON.parse(await readFile('src/locales.json','utf8'));assert.match(locales.en.stageWarning,/Preparation and cancelling a preview do not write objects/);assert.match(locales.zh.stageWarning,/预检与取消预检不会写对象/);const source=await readFile('src/IndexStage.jsx','utf8');for(const [,key] of source.matchAll(/\bt\('([^']+)'\)/g))for(const lang of ['zh','en'])assert.equal(typeof locales[lang][key],'string',key);
 for(const lang of ['zh','en']){for(const value of ['2 MiB','16 MiB','MM'])assert.ok(locales[lang].stageScope.includes(value));for(const value of ['blob','GC','HEAD'])assert.ok(locales[lang].stageWarning.includes(value));assert.match(locales[lang].stageWarning,lang==='zh'?/捕获.*仅追加.*孤立.*回滚/:/captured.*append-only.*orphan.*rollback/);}
});
