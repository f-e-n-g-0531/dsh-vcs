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
const snapshot=()=>({action:'partial-stage',path:'folder/中文.txt',head:'a'.repeat(40),index:{oid:'b'.repeat(40),mode:'100644'},plan:createPartialIndexPlan(Buffer.from('old\r\nkeep\rtrail'),Buffer.from('new\nkeep\rtrail!')),planToken:'d'.repeat(64),expiresAt:Date.now()+59000});
const result=p=>({path:p.path,head:p.head,index:p.target});
const candidate=(p,ids)=>({action:p.action,path:p.path,head:p.head,index:p.index,target:{oid:'c'.repeat(40),mode:'100644'},planId:p.plan.id,unitIds:ids,token:'e'.repeat(64),expiresAt:Date.now()+59000});
function fixture(overrides={},environment={}){
 const calls=[];let refreshes=0,unknowns=0;const planned=snapshot();let prepared;
 const handlers={'vcs/partial-stage-plan':async()=>planned,'vcs/partial-stage-prepare':async args=>(prepared=candidate(planned,args.unitIds)),'vcs/partial-stage-confirm':async()=>result(prepared),...overrides};
 const props={sessionId:'s',repositoryId:'r',id:'opaque-id',mode:'unstaged',refresh:0,t:k=>k,onStaged:()=>{refreshes++;},onUnknown:()=>{unknowns++;},rpc:(e,p,signal)=>{calls.push({e,p,signal});return handlers[e](p,signal);}};
 const h=frontendHarness('src/PartialStage.jsx',props,environment);return {h,calls,props,planned,get prepared(){return prepared;},get refreshes(){return refreshes;},get unknowns(){return unknowns;}};
}
async function plan(f){button(f.h,'partialPlan').props.onClick();await f.h.flush();}
async function select(f,n=1){input(f.h,'partialUnit '+n).props.onChange({target:{checked:true}});await f.h.flush();}
async function prepare(f){await select(f);button(f.h,'partialPrepare').props.onClick();await f.h.flush();}
async function acknowledge(f){input(f.h,'partialAcknowledge').props.onChange({target:{checked:true}});await f.h.flush();}

test('three explicit phases: ID-only planning, captured selection preview, token-only one-shot final confirmation',async()=>{
 const f=fixture();try{await f.h.flush();assert.equal(f.calls.length,0);await plan(f);assert.deepEqual(Object.keys(f.calls[0].p).sort(),['id','repositoryId','sessionId']);
 const preview=button(f.h,'partialPrepare');assert.equal(preview.props.disabled,true);await preview.props.onClick();assert.equal(f.calls.length,1);
 await select(f);await select(f);await preview.props.onClick();await f.h.flush();assert.equal(f.calls.length,2);assert.deepEqual(Object.keys(f.calls[1].p).sort(),['planToken','repositoryId','sessionId','unitIds']);assert.equal(f.calls[1].p.unitIds.length,1);assert.equal(f.calls[1].p.unitIds[0],f.planned.plan.units[0].id);
 assert.equal(input(f.h,'partialUnit 1').props.disabled,true);input(f.h,'partialUnit 1').props.onChange({target:{checked:false}});await f.h.flush();assert.equal(input(f.h,'partialUnit 1').props.checked,true);
 const final=button(f.h,'partialConfirm');assert.equal(final.props.disabled,true);await final.props.onClick();assert.equal(f.calls.length,2);await acknowledge(f);await Promise.all([final.props.onClick(),final.props.onClick()]);await f.h.flush();assert.equal(f.calls.length,3);assert.deepEqual(Object.keys(f.calls[2].p).sort(),['repositoryId','sessionId','token']);assert.equal(f.calls[2].p.token,'e'.repeat(64));assert.equal(f.refreshes,1);
 }finally{f.h.dispose();}
});

test('raw deleted and added text, 1-based coordinates and every exact newline marker',async()=>{
 const f=fixture();try{await f.h.flush();await plan(f);const text=nodeText(f.h.tree);for(const marker of ['⟦LF⟧','⟦CRLF⟧','⟦CR⟧','⟦NONE⟧']){if(marker==='⟦CR⟧')continue;assert.ok(text.includes(marker),marker);}assert.ok(text.includes('−1 (1) / +1 (1)'));assert.ok(text.includes('old'));assert.ok(text.includes('new'));assert.ok(text.includes('trail!'));assert.equal(text.includes(f.planned.planToken),false);
 const codes=renderedNodes(f.h.tree).filter(n=>n.type==='code').map(nodeText);assert.ok(codes.includes('old'));assert.ok(codes.includes('trail!'));
 }finally{f.h.dispose();}
 const p=snapshot();p.plan={...p.plan,units:p.plan.units.map((u,i)=>i?u:{...u,before:[{text:'old',terminator:'CR'}]})};const g=fixture({'vcs/partial-stage-plan':async()=>p});try{await g.h.flush();await plan(g);assert.ok(nodeText(g.h.tree).includes('⟦CR⟧'));}finally{g.h.dispose();}
});

test('deep bounded validation rejects invalid metadata, duplicate IDs, units, coordinates, bytes and tokens',async()=>{
 const patches=[p=>p.path='x'.repeat(4097),p=>p.head='bad',p=>p.planToken='bad',p=>p.index.mode='120000',p=>p.expiresAt=Date.now()+120000,p=>p.plan.algorithm='approx',p=>p.plan.beforeBytes=262145,p=>p.plan.afterLineCount=4001,p=>p.plan.lcsCells=200001,p=>p.plan.id='bad',p=>p.plan.units=Array(4001).fill(p.plan.units[0]),p=>p.plan.units.push(p.plan.units[0]),p=>p.plan.units[0].beforeCount=.5,p=>p.plan.units[0].beforeStart=-1,p=>p.plan.units[0].afterStart=2,p=>p.plan.units[0].before[0].terminator='bad',p=>p.plan.units[0].before[0].terminator='NONE',p=>p.plan.units[0].before[0].text='x'.repeat(262145),p=>p.plan.units[0].before[0].text='x\ny',p=>p.plan.units[0].before[0].text='\ud800',p=>p.plan.beforeBytes=0,p=>p.plan.units[0].before=[]];
 for(const patch of patches){const p=structuredClone(snapshot());patch(p);const f=fixture({'vcs/partial-stage-plan':async()=>p});try{await f.h.flush();await plan(f);assert.equal(button(f.h,'partialPrepare'),undefined);assert.match(nodeText(f.h.tree),/partialInvalid/);assert.equal(f.calls.length,1);}finally{f.h.dispose();}}
});

test('candidate must match path HEAD index plan and exact unique selected IDs; consumed plans require replan',async()=>{
 for(const patch of [p=>p.path='other',p=>p.head='f'.repeat(40),p=>p.index={oid:'f'.repeat(40),mode:'100644'},p=>p.target.mode='100755',p=>p.planId='f'.repeat(64),p=>p.unitIds=[],p=>p.unitIds=[p.unitIds[0],p.unitIds[0]],p=>p.token='bad']){
 const f=fixture({'vcs/partial-stage-prepare':async args=>{const p=candidate(f.planned,args.unitIds);patch(p);return p;}});try{await f.h.flush();await plan(f);await prepare(f);assert.equal(button(f.h,'partialConfirm'),undefined);assert.match(nodeText(f.h.tree),/partialInvalid/);assert.equal(button(f.h,'partialPrepare').props.disabled,true);await button(f.h,'partialPrepare').props.onClick();assert.equal(f.calls.length,2);await plan(f);assert.equal(f.calls.length,3);assert.equal(input(f.h,'partialUnit 1').props.checked,false);}finally{f.h.dispose();}
 }
});

test('replanning discards candidate token and explicit acknowledgement; no selection edits after prepare',async()=>{
 const f=fixture();try{await f.h.flush();await plan(f);await prepare(f);await acknowledge(f);const stale=button(f.h,'partialConfirm');await plan(f);await stale.props.onClick();assert.equal(f.calls.length,3);assert.equal(button(f.h,'partialConfirm'),undefined);await prepare(f);assert.equal(input(f.h,'partialAcknowledge').props.checked,false);button(f.h,'partialCancel').props.onClick();await f.h.flush();await stale.props.onClick();assert.equal(f.calls.length,4);}finally{f.h.dispose();}
});

test('both plan and candidate token expiry disable stale callbacks without writes',async()=>{
 for(const phase of ['plan','candidate']){let now=Date.now(),timer;class Clock extends Date{static now(){return now;}}const f=fixture({}, {Date:Clock,setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){}});try{await f.h.flush();await plan(f);if(phase==='candidate'){await prepare(f);await acknowledge(f);}const stale=button(f.h,phase==='plan'?'partialPrepare':'partialConfirm');now+=61001;timer();await f.h.flush();await stale.props.onClick();assert.equal(f.calls.some(c=>c.e==='vcs/partial-stage-confirm'),false);assert.match(nodeText(f.h.tree),/partialExpired/);}finally{f.h.dispose();}}
});

test('cancel/close at each read phase abort and ignore late responses',async()=>{
 for(const endpoint of ['vcs/partial-stage-plan','vcs/partial-stage-prepare'])for(const label of ['partialCancel','partialClose']){let finish;const f=fixture({[endpoint]:()=>new Promise(done=>{finish=done;})});try{await f.h.flush();await plan(f);if(endpoint.endsWith('prepare'))await prepare(f);button(f.h,label).props.onClick();await f.h.flush();assert.equal(f.calls.at(-1).signal.aborted,true);finish(endpoint.endsWith('plan')?f.planned:candidate(f.planned,[f.planned.plan.units[0].id]));await f.h.flush();assert.equal(button(f.h,'partialConfirm'),undefined);assert.equal(button(f.h,'partialPrepare'),undefined);assert.equal(f.unknowns,0);}finally{f.h.dispose();}}
});

test('all scope changes abort reads and confirmations; pending confirm unmount is unknown',async()=>{
 for(const patch of [{sessionId:'next'},{repositoryId:'next'},{id:'next'},{refresh:1},{mode:'all'}])for(const phase of ['plan','prepare','confirm']){
 let finish;const endpoint='vcs/partial-stage-'+phase,f=fixture({[endpoint]:()=>new Promise(done=>{finish=done;})});try{await f.h.flush();await plan(f);if(phase!=='plan')await prepare(f);let pending;if(phase==='confirm'){await acknowledge(f);pending=button(f.h,'partialConfirm').props.onClick();await f.h.flush();}f.h.update({...f.props,...patch});await f.h.flush();assert.equal(f.calls.at(-1).signal.aborted,true);assert.equal(f.unknowns,phase==='confirm'?1:0);finish(phase==='plan'?f.planned:phase==='prepare'?candidate(f.planned,[f.planned.plan.units[0].id]):result(f.prepared));await pending;await f.h.flush();assert.equal(button(f.h,'partialConfirm'),undefined);assert.equal(f.refreshes,0);}finally{f.h.dispose();}
 }
});

test('confirmation failure, mismatch or cancellation is unknown with no retry and explicit recovery',async()=>{
 for(const kind of ['reject','mismatch','cancel']){let finish;const f=fixture({'vcs/partial-stage-confirm':async()=>{if(kind==='reject')throw Error('lost');if(kind==='mismatch')return {...result(f.prepared),path:'wrong'};return new Promise(done=>{finish=done;});}});try{await f.h.flush();await plan(f);await prepare(f);await acknowledge(f);const final=button(f.h,'partialConfirm'),pending=final.props.onClick();await f.h.flush();if(kind==='cancel'){button(f.h,'partialClose').props.onClick();await f.h.flush();finish(result(f.prepared));}await pending;await f.h.flush();assert.equal(f.unknowns,1);assert.equal(f.refreshes,0);assert.equal(button(f.h,'partialPlan').props.disabled,true);await final.props.onClick();await button(f.h,'partialPlan').props.onClick();assert.equal(f.calls.length,3);button(f.h,'stageRecover').props.onClick();assert.equal(f.refreshes,1);}finally{f.h.dispose();}}
});

test('wrong mode and shared blocking reject all writes including callbacks captured before blocking',async()=>{
 const f=fixture();try{await f.h.flush();await plan(f);await prepare(f);await acknowledge(f);const final=button(f.h,'partialConfirm');f.h.update({...f.props,blocked:true});await f.h.flush();await final.props.onClick();assert.equal(f.calls.length,2);assert.equal(button(f.h,'partialPlan').props.disabled,true);}finally{f.h.dispose();}
 const g=fixture();try{g.h.update({...g.props,mode:'staged'});await g.h.flush();await button(g.h,'partialPlan').props.onClick();assert.equal(g.calls.length,0);}finally{g.h.dispose();}
});

test('production partial eligibility includes MM without widening whole stage; success rediscovery clears selection',async()=>{
 for(const change of [{status:'modified',indexStatus:' ',worktreeStatus:'M'},{status:'modified',indexStatus:'M',worktreeStatus:'M'},{status:'added',indexStatus:'A',worktreeStatus:' '},{status:'modified',indexStatus:' ',worktreeStatus:'M',submodule:{}},{status:'modified',indexStatus:' ',worktreeStatus:'M',oldPath:'old'}]){
 const calls=[],p=snapshot(),entry={id:'f',path:'f',...change};let prep;
 const rpc=async(e,args)=>{calls.push({e,args});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'}]};if(e==='vcs/status')return {changes:[entry]};if(e==='vcs/compare')return {...entry,left:{label:'Index',text:'a'},right:{label:'Worktree',text:'b'}};if(e==='vcs/partial-stage-plan')return p;if(e==='vcs/partial-stage-prepare')return prep=candidate(p,args.unitIds);if(e==='vcs/partial-stage-confirm')return result(prep);throw Error(e);};
 const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})});
 try{await h.flush();input(h,'gitMode').props.onChange({target:{value:'unstaged'}});await h.flush();findNode(h,n=>n.type==='button'&&n.props['data-vcs-change']).props.onClick();await h.flush();const wholeAllowed=change.indexStatus===' '&&change.worktreeStatus==='M'&&!change.submodule&&!change.oldPath,allowed=[' ','M'].includes(change.indexStatus)&&change.worktreeStatus==='M'&&!change.submodule&&!change.oldPath;assert.equal(!!button(h,'partialPlan'),allowed);assert.equal(!!button(h,'stagePrepare'),wholeAllowed);if(allowed){await plan({h});await prepare({h});await acknowledge({h});await button(h,'partialConfirm').props.onClick();await h.flush();assert.equal(calls.filter(c=>c.e==='vcs/repositories').length,2);assert.equal(button(h,'partialPlan'),undefined);}}finally{h.dispose();}
 }
});

test('production successive partial confirms rediscover MM and plan with the fresh opaque ID',async()=>{
 const calls=[];let confirmations=0,prep;
 const entry=()=>({id:confirmations?'fresh-id':'initial-id',path:'f',status:'modified',indexStatus:confirmations?'M':' ',worktreeStatus:'M'});
 const rpc=async(e,args)=>{calls.push({e,args});if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'}]};if(e==='vcs/status')return {changes:[entry()]};if(e==='vcs/compare')return {...entry(),left:{label:'Index',text:'a'},right:{label:'Worktree',text:'b'}};if(e==='vcs/partial-stage-plan'){assert.equal(args.id,entry().id);return snapshot();}if(e==='vcs/partial-stage-prepare')return prep=candidate(snapshot(),args.unitIds);if(e==='vcs/partial-stage-confirm'){confirmations++;return result(prep);}throw Error(e);};
 const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})});
 const choose=async()=>{findNode(h,n=>n.type==='button'&&n.props['data-vcs-change']).props.onClick();await h.flush();};
 try{
  await h.flush();input(h,'gitMode').props.onChange({target:{value:'unstaged'}});await h.flush();await choose();
  assert.ok(button(h,'stagePrepare'));await plan({h});await prepare({h});await acknowledge({h});await button(h,'partialConfirm').props.onClick();await h.flush();
  assert.equal(confirmations,1);assert.equal(calls.filter(c=>c.e==='vcs/repositories').length,2);assert.equal(button(h,'partialPlan'),undefined);assert.equal(button(h,'partialConfirm'),undefined);
  await choose();assert.ok(button(h,'partialPlan'));assert.equal(button(h,'stagePrepare'),undefined);assert.equal(button(h,'unstagePrepare'),undefined);
  await plan({h});assert.equal(calls.filter(c=>c.e==='vcs/partial-stage-plan').at(-1).args.id,'fresh-id');assert.equal(input(h,'partialUnit 1').props.checked,false);
  await prepare({h});assert.equal(input(h,'partialAcknowledge').props.checked,false);assert.equal(button(h,'partialConfirm').props.disabled,true);await acknowledge({h});await button(h,'partialConfirm').props.onClick();await h.flush();
  assert.equal(confirmations,2);assert.equal(calls.filter(c=>c.e==='vcs/repositories').length,3);assert.equal(calls.filter(c=>c.e==='vcs/partial-stage-confirm').length,2);assert.equal(calls.some(c=>c.e.startsWith('vcs/index-')),false);assert.equal(button(h,'partialPlan'),undefined);
 }finally{h.dispose();}
});

test('partial stage shares unknown repository latch with whole stage and unstage both directions',async()=>{
 for(const first of ['partial','stage','unstage']){
 let currentMode='all',prep;const p=snapshot(),calls=[],entry=()=>({id:'f',path:'f',status:'modified',indexStatus:currentMode==='staged'?'M':' ',worktreeStatus:currentMode==='staged'?' ':'M'});
 const rpc=async(e,args)=>{calls.push(e);if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'}]};if(e==='vcs/status'){currentMode=args.mode;return {changes:[entry()]};}if(e==='vcs/compare')return {...entry(),left:{label:'Index',text:'a'},right:{label:'Worktree',text:'b'}};if(e==='vcs/partial-stage-plan')return p;if(e==='vcs/partial-stage-prepare')return prep=candidate(p,args.unitIds);if(e.endsWith('-prepare'))return {action:first,path:p.path,head:p.head,index:p.index,target:{oid:'c'.repeat(40),mode:'100644'},token:'e'.repeat(64),expiresAt:Date.now()+59000};if(e.endsWith('-confirm'))throw Error('lost');throw Error(e);};
 const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})});
 const mode=async value=>{if(currentMode===value){input(h,'gitMode').props.onChange({target:{value:'all'}});await h.flush();}input(h,'gitMode').props.onChange({target:{value}});await h.flush();findNode(h,n=>n.type==='button'&&n.props['data-vcs-change']).props.onClick();await h.flush();};
 try{await h.flush();await mode(first==='unstage'?'staged':'unstaged');if(first==='partial'){await plan({h});await prepare({h});await acknowledge({h});}else{button(h,first+'Prepare').props.onClick();await h.flush();input(h,first+'Acknowledge').props.onChange({target:{checked:true}});await h.flush();}await button(h,first==='partial'?'partialConfirm':first+'Confirm').props.onClick();await h.flush();await mode('unstaged');assert.equal(button(h,'partialPlan').props.disabled,true);assert.equal(button(h,'stagePrepare').props.disabled,true);await button(h,'partialPlan').props.onClick();await mode('staged');assert.equal(button(h,'unstagePrepare').props.disabled,true);assert.equal(calls.filter(e=>e.endsWith('-confirm')).length,1);button(h,'refresh').props.onClick();await h.flush();await mode('unstaged');assert.equal(button(h,'partialPlan').props.disabled,false);}finally{h.dispose();}
 }
});

test('whole and partial confirmations share one synchronous repository pending gate',async()=>{
 const calls=[],p=snapshot(),entry={id:'f',path:'f',status:'modified',indexStatus:' ',worktreeStatus:'M'};let prep,finish;
 const rpc=async(e,args)=>{calls.push(e);if(e==='vcs/repositories')return {cwd:'/w',repositories:[{id:'r',type:'git',relativePath:'.'}]};if(e==='vcs/status')return {changes:[entry]};if(e==='vcs/compare')return {...entry,left:{text:'a'},right:{text:'b'}};if(e==='vcs/partial-stage-plan')return p;if(e==='vcs/partial-stage-prepare')return prep=candidate(p,args.unitIds);if(e==='vcs/index-stage-prepare')return {...candidate(p,[]),action:'stage'};if(e.endsWith('-confirm'))return new Promise(resolve=>{finish=()=>resolve(result(prep));});throw Error(e);};
 const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:choose=>choose({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})});
 try{await h.flush();input(h,'gitMode').props.onChange({target:{value:'unstaged'}});await h.flush();findNode(h,n=>n.type==='button'&&n.props['data-vcs-change']).props.onClick();await h.flush();await plan({h});await prepare({h});await acknowledge({h});button(h,'stagePrepare').props.onClick();await h.flush();input(h,'stageAcknowledge').props.onChange({target:{checked:true}});await h.flush();const stale=button(h,'stageConfirm'),pending=button(h,'partialConfirm').props.onClick();const competitor=stale.props.onClick();await h.flush();assert.equal(calls.filter(e=>e.endsWith('-confirm')).length,1);finish();await Promise.all([pending,competitor]);await h.flush();}finally{h.dispose();}
});
test('targeted in-memory compilation and bilingual safety labels',async()=>{
 for(const entry of ['src/PartialStage.jsx','scripts/partial-stage-browser.jsx']){const result=await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'esm',external:['react','react-dom/client','react-dom']});assert.ok(result.outputFiles[0].contents.length);}
 const locales=JSON.parse(await readFile('src/locales.json','utf8')),source=await readFile('src/PartialStage.jsx','utf8');for(const [,key] of source.matchAll(/\bt\('([^']+)'\)/g))for(const lang of ['zh','en'])assert.equal(typeof locales[lang][key],'string',key);
 for(const lang of ['zh','en']){for(const term of ['256 KiB','4000','200000','MM','2 MiB','16 MiB'])assert.ok(locales[lang].partialScope.includes(term));for(const term of ['blob','GC','HEAD'])assert.ok(locales[lang].partialWarning.includes(term));}
});
