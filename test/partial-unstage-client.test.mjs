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
import {createPartialIndexPlan} from '../src/partial-index.mjs';
const snapshot=()=>({action:'partial-unstage',path:'folder/中文.txt',head:'a'.repeat(40),index:{oid:'b'.repeat(40),mode:'100644'},plan:createPartialIndexPlan(Buffer.from('old\r\nkeep\rtrail'),Buffer.from('new\nkeep\rtrail!')),planToken:'d'.repeat(64),expiresAt:Date.now()+59000});
const result=p=>({path:p.path,head:p.head,index:p.target});
const candidate=(p,ids)=>({action:p.action,path:p.path,head:p.head,index:p.index,target:{oid:'c'.repeat(40),mode:'100644'},planId:p.plan.id,unitIds:ids,token:'e'.repeat(64),expiresAt:Date.now()+59000});
function fixture(overrides={},environment={}){
 const calls=[];let refreshes=0,unknowns=0;const planned=snapshot();let prepared;
 const handlers={'vcs/partial-unstage-plan':async()=>planned,'vcs/partial-unstage-prepare':async args=>(prepared=candidate(planned,args.unitIds)),'vcs/partial-unstage-confirm':async()=>result(prepared),...overrides};
 const props={sessionId:'s',repositoryId:'r',id:'opaque-id',mode:'staged',refresh:0,t:k=>k,onUnstaged:()=>{refreshes++;},onUnknown:()=>{unknowns++;},rpc:(e,p,signal)=>{calls.push({e,p,signal});return handlers[e](p,signal);}};
 const h=frontendHarness('src/PartialUnstage.jsx',props,environment);return {h,calls,props,planned,get prepared(){return prepared;},get refreshes(){return refreshes;},get unknowns(){return unknowns;}};
}
async function plan(f){button(f.h,'partialUnstagePlan').props.onClick();await f.h.flush();}
async function select(f,n=1){input(f.h,'partialUnstageUnit '+n).props.onChange({target:{checked:true}});await f.h.flush();}
async function prepare(f){await select(f);button(f.h,'partialUnstagePrepare').props.onClick();await f.h.flush();}
async function acknowledge(f){input(f.h,'partialUnstageAcknowledge').props.onChange({target:{checked:true}});await f.h.flush();}

test('three explicit phases: ID-only planning, captured selection preview, token-only one-shot final confirmation',async()=>{
 const f=fixture();try{await f.h.flush();assert.equal(f.calls.length,0);await plan(f);assert.deepEqual(Object.keys(f.calls[0].p).sort(),['id','repositoryId','sessionId']);
 const preview=button(f.h,'partialUnstagePrepare');assert.equal(preview.props.disabled,true);await preview.props.onClick();assert.equal(f.calls.length,1);
 await select(f);await select(f);await preview.props.onClick();await f.h.flush();assert.equal(f.calls.length,2);assert.deepEqual(Object.keys(f.calls[1].p).sort(),['planToken','repositoryId','sessionId','unitIds']);assert.equal(f.calls[1].p.unitIds.length,1);assert.equal(f.calls[1].p.unitIds[0],f.planned.plan.units[0].id);
 assert.equal(input(f.h,'partialUnstageUnit 1').props.disabled,true);input(f.h,'partialUnstageUnit 1').props.onChange({target:{checked:false}});await f.h.flush();assert.equal(input(f.h,'partialUnstageUnit 1').props.checked,true);
 const final=button(f.h,'partialUnstageConfirm');assert.equal(final.props.disabled,true);await final.props.onClick();assert.equal(f.calls.length,2);await acknowledge(f);await Promise.all([final.props.onClick(),final.props.onClick()]);await f.h.flush();assert.equal(f.calls.length,3);assert.deepEqual(Object.keys(f.calls[2].p).sort(),['repositoryId','sessionId','token']);assert.equal(f.calls[2].p.token,'e'.repeat(64));assert.equal(f.refreshes,1);
 }finally{f.h.dispose();}
});

test('raw deleted and added text, 1-based coordinates and every exact newline marker',async()=>{
 const f=fixture();try{await f.h.flush();await plan(f);const text=nodeText(f.h.tree);for(const marker of ['⟦LF⟧','⟦CRLF⟧','⟦CR⟧','⟦NONE⟧']){if(marker==='⟦CR⟧')continue;assert.ok(text.includes(marker),marker);}assert.ok(text.includes('−1 (1) / +1 (1)'));assert.ok(text.includes('old'));assert.ok(text.includes('new'));assert.ok(text.includes('trail!'));assert.equal(text.includes(f.planned.planToken),false);
 const codes=renderedNodes(f.h.tree).filter(n=>n.type==='code').map(nodeText);assert.ok(codes.includes('old'));assert.ok(codes.includes('trail!'));
 }finally{f.h.dispose();}
 const p=snapshot();p.plan={...p.plan,units:p.plan.units.map((u,i)=>i?u:{...u,before:[{text:'old',terminator:'CR'}]})};const g=fixture({'vcs/partial-unstage-plan':async()=>p});try{await g.h.flush();await plan(g);assert.ok(nodeText(g.h.tree).includes('⟦CR⟧'));}finally{g.h.dispose();}
});

test('deep bounded validation rejects invalid metadata, duplicate IDs, units, coordinates, bytes and tokens',async()=>{
 const patches=[p=>p.action='partial-stage',p=>p.path='x'.repeat(4097),p=>p.head='bad',p=>p.planToken='bad',p=>p.index.mode='120000',p=>p.expiresAt=Date.now()+120000,p=>p.plan.algorithm='approx',p=>p.plan.beforeBytes=262145,p=>p.plan.afterLineCount=4001,p=>p.plan.lcsCells=200001,p=>p.plan.id='bad',p=>p.plan.units=Array(4001).fill(p.plan.units[0]),p=>p.plan.units.push(p.plan.units[0]),p=>p.plan.units[0].beforeCount=.5,p=>p.plan.units[0].beforeStart=-1,p=>p.plan.units[0].afterStart=2,p=>p.plan.units[0].before[0].terminator='bad',p=>p.plan.units[0].before[0].terminator='NONE',p=>p.plan.units[0].before[0].text='x'.repeat(262145),p=>p.plan.units[0].before[0].text='x\ny',p=>p.plan.units[0].before[0].text='\ud800',p=>p.plan.beforeBytes=0,p=>p.plan.units[0].before=[]];
 for(const patch of patches){const p=structuredClone(snapshot());patch(p);const f=fixture({'vcs/partial-unstage-plan':async()=>p});try{await f.h.flush();await plan(f);assert.equal(button(f.h,'partialUnstagePrepare'),undefined);assert.match(nodeText(f.h.tree),/partialUnstageInvalid/);assert.equal(f.calls.length,1);}finally{f.h.dispose();}}
});

test('candidate must match path HEAD index plan and exact unique selected IDs; consumed plans require replan',async()=>{
 for(const patch of [p=>p.action='partial-stage',p=>p.unitIds=['f'.repeat(64)],p=>p.path='other',p=>p.head='f'.repeat(40),p=>p.index={oid:'f'.repeat(40),mode:'100644'},p=>p.target.mode='100755',p=>p.planId='f'.repeat(64),p=>p.unitIds=[],p=>p.unitIds=[p.unitIds[0],p.unitIds[0]],p=>p.token='bad']){
 const f=fixture({'vcs/partial-unstage-prepare':async args=>{const p=candidate(f.planned,args.unitIds);patch(p);return p;}});try{await f.h.flush();await plan(f);await prepare(f);assert.equal(button(f.h,'partialUnstageConfirm'),undefined);assert.match(nodeText(f.h.tree),/partialUnstageInvalid/);assert.equal(button(f.h,'partialUnstagePrepare').props.disabled,true);await button(f.h,'partialUnstagePrepare').props.onClick();assert.equal(f.calls.length,2);await plan(f);assert.equal(f.calls.length,3);assert.equal(input(f.h,'partialUnstageUnit 1').props.checked,false);}finally{f.h.dispose();}
 }
});

test('replanning discards candidate token and explicit acknowledgement; no selection edits after prepare',async()=>{
 const f=fixture();try{await f.h.flush();await plan(f);await prepare(f);await acknowledge(f);const stale=button(f.h,'partialUnstageConfirm');await plan(f);await stale.props.onClick();assert.equal(f.calls.length,3);assert.equal(button(f.h,'partialUnstageConfirm'),undefined);await prepare(f);assert.equal(input(f.h,'partialUnstageAcknowledge').props.checked,false);button(f.h,'partialUnstageCancel').props.onClick();await f.h.flush();await stale.props.onClick();assert.equal(f.calls.length,4);}finally{f.h.dispose();}
});

test('both plan and candidate token expiry disable stale callbacks without writes',async()=>{
 for(const phase of ['plan','candidate']){let now=Date.now(),timer;class Clock extends Date{static now(){return now;}}const f=fixture({}, {Date:Clock,setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){}});try{await f.h.flush();await plan(f);if(phase==='candidate'){await prepare(f);await acknowledge(f);}const stale=button(f.h,phase==='plan'?'partialUnstagePrepare':'partialUnstageConfirm');now+=61001;timer();await f.h.flush();await stale.props.onClick();assert.equal(f.calls.some(c=>c.e==='vcs/partial-unstage-confirm'),false);assert.match(nodeText(f.h.tree),/partialUnstageExpired/);}finally{f.h.dispose();}}
});

test('cancel/close at each read phase abort and ignore late responses',async()=>{
 for(const endpoint of ['vcs/partial-unstage-plan','vcs/partial-unstage-prepare'])for(const label of ['partialUnstageCancel','partialUnstageClose']){let finish;const f=fixture({[endpoint]:()=>new Promise(done=>{finish=done;})});try{await f.h.flush();await plan(f);if(endpoint.endsWith('prepare'))await prepare(f);button(f.h,label).props.onClick();await f.h.flush();assert.equal(f.calls.at(-1).signal.aborted,true);finish(endpoint.endsWith('plan')?f.planned:candidate(f.planned,[f.planned.plan.units[0].id]));await f.h.flush();assert.equal(button(f.h,'partialUnstageConfirm'),undefined);assert.equal(button(f.h,'partialUnstagePrepare'),undefined);assert.equal(f.unknowns,0);}finally{f.h.dispose();}}
});

test('all scope changes abort reads and confirmations; pending confirm unmount is unknown',async()=>{
 for(const patch of [{sessionId:'next'},{repositoryId:'next'},{id:'next'},{refresh:1},{mode:'all'}])for(const phase of ['plan','prepare','confirm']){
 let finish;const endpoint='vcs/partial-unstage-'+phase,f=fixture({[endpoint]:()=>new Promise(done=>{finish=done;})});try{await f.h.flush();await plan(f);if(phase!=='plan')await prepare(f);let pending;if(phase==='confirm'){await acknowledge(f);pending=button(f.h,'partialUnstageConfirm').props.onClick();await f.h.flush();}f.h.update({...f.props,...patch});await f.h.flush();assert.equal(f.calls.at(-1).signal.aborted,true);assert.equal(f.unknowns,phase==='confirm'?1:0);finish(phase==='plan'?f.planned:phase==='prepare'?candidate(f.planned,[f.planned.plan.units[0].id]):result(f.prepared));await pending;await f.h.flush();assert.equal(button(f.h,'partialUnstageConfirm'),undefined);assert.equal(f.refreshes,0);}finally{f.h.dispose();}
 }
});

test('confirmation failure, mismatch or cancellation is unknown with no retry and explicit recovery',async()=>{
 for(const kind of ['reject','mismatch','cancel']){let finish;const f=fixture({'vcs/partial-unstage-confirm':async()=>{if(kind==='reject')throw Error('lost');if(kind==='mismatch')return {...result(f.prepared),path:'wrong'};return new Promise(done=>{finish=done;});}});try{await f.h.flush();await plan(f);await prepare(f);await acknowledge(f);const final=button(f.h,'partialUnstageConfirm'),pending=final.props.onClick();await f.h.flush();if(kind==='cancel'){button(f.h,'partialUnstageClose').props.onClick();await f.h.flush();finish(result(f.prepared));}await pending;await f.h.flush();assert.equal(f.unknowns,1);assert.equal(f.refreshes,0);assert.equal(button(f.h,'partialUnstagePlan').props.disabled,true);await final.props.onClick();await button(f.h,'partialUnstagePlan').props.onClick();assert.equal(f.calls.length,3);button(f.h,'stageRecover').props.onClick();assert.equal(f.refreshes,1);}finally{f.h.dispose();}}
});

test('wrong mode and shared blocking reject all writes including callbacks captured before blocking',async()=>{
 const f=fixture();try{await f.h.flush();await plan(f);await prepare(f);await acknowledge(f);const final=button(f.h,'partialUnstageConfirm');f.h.update({...f.props,blocked:true});await f.h.flush();await final.props.onClick();assert.equal(f.calls.length,2);assert.equal(button(f.h,'partialUnstagePlan').props.disabled,true);}finally{f.h.dispose();}
 const g=fixture();try{g.h.update({...g.props,mode:'unstaged'});await g.h.flush();await button(g.h,'partialUnstagePlan').props.onClick();assert.equal(g.calls.length,0);}finally{g.h.dispose();}
});

test('production partial-unstage: strict default all keeps mutation panels absent without RPC across loaded and pending states',async()=>{
 for(const state of ['modified','added','deleted','MM','empty','error','pending-status','scanning','svn']){
  const calls=[];let discover;
  const entry={id:'f',path:'f',status:['added','deleted'].includes(state)?state:'modified',indexStatus:state==='MM'?'M':' ',worktreeStatus:'M'};
  const rpc=async(e,p)=>{calls.push({e,p});if(e==='vcs/repositories'){const value={cwd:'/w',repositories:[{id:'r',type:state==='svn'?'svn':'git',relativePath:'.'}]};if(state==='scanning')return new Promise(done=>discover=()=>done(value));return value;}if(e==='vcs/status'){assert.equal(p.mode,'all');if(state==='pending-status')return new Promise(()=>{});if(state==='error')throw Error('status failed');return {changes:state==='empty'?[]:[entry]};}if(e==='vcs/compare'){assert.equal(p.mode,'all');return {...entry,left:{label:'HEAD',text:'a'},right:{label:'Worktree',text:'b'}};}if(e==='vcs/svn-identity')return {};throw Error('Unexpected production RPC '+e);};
  const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})});
  const absent=()=>{assert.ok(calls.filter(c=>['vcs/status','vcs/compare'].includes(c.e)).every(c=>c.p.mode==='all'));assert.equal(input(h,'gitMode'),undefined);for(const name of ['BranchSwitcher','BranchCreate','TagCreate','LightweightTagCreate','BranchDeletePreview','CommitPanel','AmendPanel','IndexStage','IndexUnstage','PartialStage','PartialUnstage','LineStage','LineUnstage'])assert.equal(findNode(h,n=>typeof n.type==='function'&&n.type.name===name),undefined,name);for(const label of ['branchSwitcher','branchCreatePrepare','tagCreatePrepare','lightweightTagPrepare','branchDeletePreviewAssess','commitPrepare','amendPrepare','stagePrepare','unstagePrepare','partialPlan','partialUnstagePlan','linePlan'])assert.equal(button(h,label),undefined,label);assert.deepEqual(calls.filter(c=>!['vcs/repositories','vcs/status','vcs/compare','vcs/svn-identity'].includes(c.e)),[]);};
  try{await h.flush();absent();if(discover){discover();await h.flush();absent();}const file=findNode(h,n=>n.type==='button'&&n.props['data-vcs-change']);if(file){file.props.onClick();await h.flush();absent();assert.ok(calls.some(c=>c.e==='vcs/compare'));}assert.ok(calls.some(c=>c.e==='vcs/status'));}finally{h.dispose();}
 }
});

test('production partial-unstage: refresh, focus, repository selection and review return never expose mutation entry points',async()=>{
 const calls=[],events=new Map(),win={addEventListener:(e,fn)=>events.set(e,fn),removeEventListener:e=>events.delete(e)};
 const rpc=async(e,p)=>{calls.push({e,p});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'},{id:'other',type:'git',relativePath:'other'},{id:'svn',type:'svn',relativePath:'svn'}]};if(e==='vcs/status'){assert.equal(p.mode,'all');return {changes:[]};}if(e==='vcs/history')return {snapshot:'a'.repeat(40),commits:[],nextOffset:null};if(e==='vcs/svn-identity')return {};throw Error('Unexpected production RPC '+e);};
 const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})},{window:win});
 const absent=()=>{assert.ok(calls.filter(c=>['vcs/status','vcs/compare'].includes(c.e)).every(c=>c.p.mode==='all'));assert.equal(input(h,'gitMode'),undefined);assert.equal(findNode(h,n=>typeof n.type==='function'&&['BranchSwitcher','BranchCreate','TagCreate','LightweightTagCreate','BranchDeletePreview','CommitPanel','AmendPanel','IndexStage','IndexUnstage','PartialStage','PartialUnstage','LineStage','LineUnstage'].includes(n.type.name)),undefined);assert.deepEqual(calls.filter(c=>!['vcs/repositories','vcs/status','vcs/history','vcs/svn-identity'].includes(c.e)),[]);};
 try{await h.flush();absent();for(const id of ['other','svn','r']){input(h,'repositories').props.onChange({target:{value:id}});await h.flush();absent();}const before=calls.filter(c=>c.e==='vcs/status').length;button(h,'refresh').props.onClick();await h.flush();events.get('focus')?.({target:win});await h.flush();absent();assert.ok(calls.filter(c=>c.e==='vcs/status').length>before);button(h,'allCommits').props.onClick();await h.flush();absent();assert.ok(calls.some(c=>c.e==='vcs/history'));button(h,'localChanges').props.onClick();await h.flush();absent();}finally{h.dispose();}
});







test('targeted in-memory compilation and bilingual safety labels',async()=>{
 for(const entry of ['src/PartialUnstage.jsx','scripts/partial-unstage-browser.jsx']){const result=await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'esm',external:['react','react-dom/client','react-dom']});assert.ok(result.outputFiles[0].contents.length);}
 const locales=JSON.parse(await readFile('src/locales.json','utf8')),source=await readFile('src/PartialUnstage.jsx','utf8');for(const [,key] of source.matchAll(/\bt\('([^']+)'\)/g))for(const lang of ['zh','en'])assert.equal(typeof locales[lang][key],'string',key);
 for(const lang of ['zh','en']){for(const term of ['256 KiB','4000','200000','MM','2 MiB','16 MiB'])assert.ok(locales[lang].partialUnstageScope.includes(term));for(const term of ['blob','GC','HEAD'])assert.ok(locales[lang].partialUnstageWarning.includes(term));}
});
