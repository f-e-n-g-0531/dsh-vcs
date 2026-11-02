import test from 'node:test';
import assert from 'node:assert/strict';
import {build,transformSync} from 'esbuild';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
test('frontend and new browser journeys bundle without writing shared dist',async()=>{
 for(const entry of ['src/client.jsx','scripts/search-navigation-browser.jsx','scripts/review-context-browser.jsx','scripts/history-tree-pages-browser.jsx','scripts/tree-browser.jsx','scripts/branch-history-browser.jsx','scripts/stash-browser.jsx']){
  const result=await build({entryPoints:[entry],bundle:true,write:false,platform:'browser',format:'esm',external:['react','react-dom/client','react-dom'],loader:{'.css':'text'}});
  assert.ok(result.outputFiles[0].contents.length>0,entry);
 }
});
test('new scope owners keep request cancellation and old endpoint fallback explicit',async()=>{
 for(const file of ['GrepPanel.jsx','HistoricalTree.jsx','FileHistory.jsx','PathHistory.jsx']){
  const source=await readFile(new URL('../src/'+file,import.meta.url),'utf8');
  assert.match(source,/controller.*abort|c.signal.aborted/s,file);assert.match(source,/signal.aborted/,file);
 }
 const blame=await readFile(new URL('../src/BlamePanel.jsx',import.meta.url),'utf8');
 assert.ok(blame.includes(':onSelectCommit(row.commit,row.path||null)'));
 const tree=await readFile(new URL('../src/HistoricalTree.jsx',import.meta.url),'utf8');
 assert.ok(tree.includes('vcs/tree-page'));assert.ok(tree.includes("e.code!=='vcs/not-found'"));
});

// Execute the actual JSX modules in memory. Hooks/effect generations and keyed
// unmounts are modeled here; no DOM/browser or generated module files are used.
function frontendHarness(entry, initialProps) {
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
 const context={AbortController,URL,Set,Map,console,window:{addEventListener(){},removeEventListener(){}},document,setTimeout,clearTimeout};
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

test('production createPage wires SVN consent log and revoke identities across repository and Session switches',async()=>{
 let session={id:'s',cwd:'/workspace'},counter=0;const calls=[];
 const rpc=async(e,p,signal)=>{calls.push({e,p,signal});
  if(e==='vcs/repositories')return {cwd:session.cwd,repositories:['r1','r2'].map(id=>({id,type:'svn',relativePath:id}))};
  if(e==='vcs/status')return {changes:[]};
  if(e==='vcs/svn-describe')return {offer:'a'.repeat(64),remoteEnabled:true};
  if(e==='vcs/svn-approve')return {token:(++counter).toString(16).padStart(64,'0'),snapshot:'9',expiresAt:Date.now()+299000};
  if(e==='vcs/svn-log')return {entries:[],nextRevision:null};
  if(e==='vcs/svn-revoke')return {revoked:true};
  throw Error('Unexpected production SVN RPC '+e);
 };
 const ctx=workspaceContext(rpc),pageProps={ctx,options:{initialView:'history'},useSessions:select=>select({byId:{current:{...session,retainedBy:{mainView:1}}}})};
 const h=frontendHarness('src/client.jsx',pageProps);
 const approve=async(s,r)=>{await h.flush();button(h,'svnConsentReview').props.onClick();await h.flush();findNode(h,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});await h.flush();button(h,'svnConsentApprove').props.onClick();await h.flush();const latest=calls.filter(c=>['vcs/svn-describe','vcs/svn-approve','vcs/svn-log'].includes(c.e)).slice(-3);assert.deepEqual(latest.map(c=>c.e),['vcs/svn-describe','vcs/svn-approve','vcs/svn-log']);for(const call of latest)assert.deepEqual([call.p.sessionId,call.p.repositoryId],[s,r]);assert.ok(button(h,'svnRevoke'));};
 try{await approve('s','r1');input(h,'repositories').props.onChange({target:{value:'r2'}});await approve('s','r2');assert.ok(calls.some(c=>c.e==='vcs/svn-revoke'&&c.p.repositoryId==='r1'));
  session={id:'s2',cwd:'/next'};h.update({...pageProps,useSessions:select=>select({byId:{current:{...session,retainedBy:{mainView:1}}}})});await approve('s2','r1');button(h,'svnRevoke').props.onClick();await h.flush();assert.ok(button(h,'svnConsentReview'));assert.ok(calls.some(c=>c.e==='vcs/svn-revoke'&&c.p.sessionId==='s2'&&c.p.repositoryId==='r1'));
 }finally{h.dispose();}
});

test('production status category counts do not depend on file selection or filters',async()=>{
 const changes={r1:[{id:'m',path:'m',status:'modified'},{id:'a',path:'a',status:'added'}],r2:[{id:'d',path:'d',status:'deleted'}]};
 const rpc=async(e,p)=>e==='vcs/repositories'?{cwd:'/w',repositories:['r1','r2'].map(id=>({id,type:'git',relativePath:id}))}:e==='vcs/status'?{changes:changes[p.repositoryId]}:e==='vcs/compare'?{path:'m',left:{text:''},right:{text:'x'}}:null;
 const h=frontendHarness('src/client.jsx',{ctx:workspaceContext(rpc),useSessions:select=>select({byId:{s:{id:'s',cwd:'/w',retainedBy:{mainView:1}}}})});
 const counts=()=>findNode(h,n=>n.type?.name==='StatusFilterBar').props.statusCounts;
 try{await h.flush();assert.equal(counts().all,2);assert.equal(counts().modified,1);assert.equal(counts().added,1);
  findNode(h,n=>n.type?.name==='FileBrowser').props.onSelect('r1','m');await h.flush();assert.equal(counts().all,2);
  input(h,'search').props.onChange({target:{value:'not-found'}});await h.flush();assert.equal(counts().all,2);
  input(h,'repositories').props.onChange({target:{value:'r2'}});await h.flush();assert.equal(counts().all,1);assert.equal(counts().deleted,1);
 }finally{h.dispose();}
});

test('same-OID branch tag and HEAD transitions reload first page without snapshot drift',async()=>{
 const X='a'.repeat(40),refs=['refs/heads/A','refs/tags/B'],calls=[];
 const rpc=async(e,p,signal)=>{calls.push({e,p,signal});if(e==='vcs/references')return {references:refs.map(name=>({name,commit:X}))};if(e==='vcs/history')return {snapshot:X,commits:[{id:(p.offset?'b':'a').repeat(40),subject:'row '+p.offset,parents:[]}],nextOffset:p.offset?null:50};throw Error('Unexpected history endpoint '+e);};
 const h=frontendHarness('src/HistoryPanel.jsx',{sessionId:'s',repositoryId:'r',rpc,t:k=>k,onRediscover(){},showSearch:true});
 const choose=async name=>{input(h,'historyBranch').props.onChange({target:{value:name?JSON.stringify([name,X]):''}});await h.flush();assert.ok(button(h,'row 0'));assert.equal(calls.at(-1).p.offset,0);assert.equal(calls.at(-1).p.snapshot,name?X:undefined);};
 try{await h.flush();button(h,'revisionLoadRefs').props.onClick();await h.flush();
  await choose(refs[0]);const before=calls.length;await choose(refs[1]);assert.equal(calls.length,before+1);
  await choose('');await choose(refs[0]);button(h,'historyMore').props.onClick();await h.flush();assert.ok(button(h,'row 50'));await choose(refs[1]);assert.equal(button(h,'row 50'),undefined);
  input(h,'historyServer_message').props.onChange({target:{value:'literal'}});await h.flush();findNode(h,n=>n.type==='form'&&n.props['aria-label']==='historyServerSearch').props.onSubmit({preventDefault(){}});await h.flush();await choose(refs[0]);assert.equal(calls.at(-1).p.search.message,'literal');
 }finally{h.dispose();}
});

test('stash history and Blame commits render as text instead of no-op navigation',async()=>{
 const A='a'.repeat(40),B='b'.repeat(40),id='d'.repeat(64),calls=[];
 const rpc=async(e,p)=>{calls.push({e,p});if(e==='vcs/stash-list')return {stashes:[{id:A,ref:'stash@{0}',message:'stash'}]};if(e==='vcs/commit')return {id:A,subject:'stash',parents:[],changes:[{id,path:'f',status:'modified'}]};if(e==='vcs/commit-compare')return {path:'f',left:{text:'a'},right:{text:'b'}};if(e==='vcs/file-history')return {path:'f',commits:[{id:B,subject:'earlier',path:'f'}],nextOffset:null};if(e==='vcs/blame')return {lines:[{line:1,commit:B,text:'b'}]};throw Error('Unexpected stash RPC '+e);};
 const h=frontendHarness('src/StashPanel.jsx',{sessionId:'s',repositoryId:'r',rpc,t:k=>k,onRediscover(){}});
 try{await h.flush();button(h,'stash@{0} · stash').props.onClick();await h.flush();button(h,'modified · f').props.onClick();await h.flush();button(h,'fileHistory').props.onClick();button(h,'blame').props.onClick();await h.flush();assert.ok(nodeText(h.tree).includes('earlier'));assert.equal(button(h,'earlier'),undefined);assert.equal(findNode(h,n=>n.type==='button'&&n.props.title===B),undefined);assert.equal(calls.filter(c=>c.e==='vcs/commit').length,1);
 }finally{h.dispose();}
});

test('a superseded same-OID reference request cannot replace the active first page',async()=>{
 const X='a'.repeat(40),calls=[];let late;
 const rpc=(e,p,signal)=>{calls.push({e,p,signal});if(e==='vcs/references')return Promise.resolve({references:['refs/heads/A','refs/tags/B'].map(name=>({name,commit:X}))});if(e==='vcs/history'&&p.snapshot&&!late)return new Promise(resolve=>{late=resolve;});return Promise.resolve({snapshot:X,commits:[{id:X,subject:'current row',parents:[]}],nextOffset:null});};
 const h=frontendHarness('src/HistoryPanel.jsx',{sessionId:'s',repositoryId:'r',rpc,t:k=>k,onRediscover(){}});
 try{await h.flush();button(h,'revisionLoadRefs').props.onClick();await h.flush();const choose=name=>input(h,'historyBranch').props.onChange({target:{value:JSON.stringify([name,X])}});
  choose('refs/heads/A');await h.flush();const old=calls.at(-1);choose('refs/tags/B');await h.flush();assert.equal(old.signal.aborted,true);assert.ok(button(h,'current row'));late({snapshot:X,commits:[{id:'b'.repeat(40),subject:'late obsolete row',parents:[]}],nextOffset:null});await h.flush();assert.equal(button(h,'late obsolete row'),undefined);assert.ok(button(h,'current row'));
 }finally{h.dispose();}
});

test('bilingual audited hints describe actual encoding image and paged Blame scope',async()=>{
 const locales=JSON.parse(await readFile(new URL('../src/locales.json',import.meta.url),'utf8'));
 for(const lang of ['zh','en']){const text=locales[lang];assert.match(text.workspaceLargeScope,/UTF-8.*GBK.*UTF-16/);assert.match(text.largeScope,/UTF-8.*GBK.*UTF-16/);assert.match(text.imageCompare,/PNG.*JPEG.*WebP/);assert.match(text.blameScope,/每页|per page/);assert.doesNotMatch(text.blameLimit,/前 500|first 500/);assert.match(text.stashScope,/不支持跨提交|not supported/);}
});
