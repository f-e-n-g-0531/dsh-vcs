import React from 'react';
import {createRoot} from 'react-dom/client';
import HistoryPanel from '../src/HistoryPanel.jsx';
import CommitDetails from '../src/CommitDetails.jsx';
import locales from '../src/locales.json';
import FileHistory from '../src/FileHistory.jsx';
export async function checkHistoryNavigation(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40),calls=[];
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('History navigation timeout');};
 const button=text=>[...host.querySelectorAll('button')].find(e=>e.textContent===text);
 const row=(id,subject)=>({id,subject,author:'Author',date:'2026-09-29T00:00:00Z',parents:[]});
 const message='Subject\n\n中文正文\n<img src=x onerror=alert(1)>\nTrailer: value';
 const rpc=async(endpoint,p,signal)=>{
  calls.push({endpoint,p,signal});
  if(endpoint==='vcs/history')return {snapshot:a,commits:[row(a,'start')],nextOffset:null};
  if(endpoint==='vcs/commit')return {...row(p.commit,p.commit===a?'start details':'destination details'),message:p.commit===a?message:'Destination message',parents:p.commit===a?[b,c]:[],parent:p.commit===a?[b,c][p.parentIndex]:null,changes:[{id:(p.commit===a?'d':'e').repeat(64),path:'file.txt',status:'modified'}]};
  if(endpoint==='vcs/commit-compare')return {path:'file.txt',left:{label:b,text:'old'},right:{label:a,text:'new'}};
  if(endpoint==='vcs/file-history')return {path:'file.txt',commits:[row(b,'visit destination')],nextOffset:null};
  throw Error('Unexpected navigation RPC '+endpoint);
 };
 try{
  root.render(<HistoryPanel sessionId="s" repositoryId="r" rpc={rpc} t={k=>k} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>);
  await wait(()=>button('start'));button('start').click();await wait(()=>host.querySelector('select[aria-label="commitParent"]'));
  const pre=host.querySelector('[aria-label=commitDetails] pre');if(pre?.textContent!==message||pre.querySelector('img')||getComputedStyle(pre).whiteSpace!=='pre-wrap')throw Error('Commit message was not preserved as wrapped plain text');
  const select=host.querySelector('select[aria-label="commitParent"]');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));
  await wait(()=>calls.some(x=>x.endpoint==='vcs/commit'&&x.p.parentIndex===1)&&button('modified · file.txt'));button('modified · file.txt').click();
  await wait(()=>button('fileHistory'));button('fileHistory').click();await wait(()=>button('visit destination'));button('visit destination').click();
  await wait(()=>host.querySelector('[aria-label=commitDetails] h3')?.textContent==='destination details');
  if(host.querySelector('[aria-label=commitDetails] pre')?.textContent!=='Destination message'||host.textContent.includes('Trailer: value'))throw Error('Old commit message survived navigation');
  const destination=calls.find(x=>x.endpoint==='vcs/commit'&&x.p.commit===b);if(!destination||destination.p.parentIndex!==0)throw Error('Navigation did not reset parent');
  if(calls.filter(x=>x.p.commit===a&&['vcs/commit-compare','vcs/file-history'].includes(x.endpoint)).some(x=>!x.signal.aborted))throw Error('Old comparison requests survived navigation');
  await wait(()=>calls.some(x=>x.endpoint==='vcs/commit-compare'&&x.p.commit===b));
  const navigated=calls.find(x=>x.endpoint==='vcs/commit-compare'&&x.p.commit===b);if(navigated.p.parentIndex!==0||navigated.p.id!=='e'.repeat(64)||button('modified · file.txt')?.getAttribute('aria-pressed')!=='true')throw Error('Navigation did not select exact target file');
  if(host.querySelector('select[aria-label="commitParent"]'))throw Error('Old parent state survived navigation');
  const beforeReplay=calls.filter(x=>x.endpoint==='vcs/commit-compare'&&x.p.commit===b).length;
  await wait(()=>button('fileHistory'));button('fileHistory').click();await wait(()=>button('visit destination'));button('visit destination').click();
  await wait(()=>calls.filter(x=>x.endpoint==='vcs/commit-compare'&&x.p.commit===b).length===beforeReplay+1);
  if(!navigated.signal.aborted||button('modified · file.txt')?.getAttribute('aria-pressed')!=='true')throw Error('Same OID navigation did not reset and reselect');
  const countAfterReplay=calls.length;
  const filter=host.querySelector('input[aria-label=commitFileSearch]');
  const setFilter=value=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(filter,value);filter.dispatchEvent(new Event('input',{bubbles:true}));};
  setFilter('missing');await wait(()=>!host.querySelector('.vcs-text-comparison')&&!button('modified · file.txt'));
  setFilter('');await wait(()=>button('modified · file.txt'));
  if(button('modified · file.txt').getAttribute('aria-pressed')!=='false'||calls.length!==countAfterReplay)throw Error('Consumed navigation reselected after search');
  if(calls.filter(x=>x.endpoint==='vcs/history').length!==1)throw Error('Navigation reloaded pinned history');
  for(const path of ['missing.txt','file.txt']){
   const navigationCalls=[];const navRpc=(endpoint,p,signal)=>{navigationCalls.push({endpoint,p});return rpc(endpoint,p,signal);};
   root.render(<CommitDetails key={path} initialPath={path} sessionId='s' repositoryId='r' commit={a} rpc={navRpc} t={k=>k} onRediscover={()=>{}}/>);
   await wait(()=>host.querySelector('select[aria-label=commitParent]'));
   if(path==='file.txt')await wait(()=>navigationCalls.some(x=>x.endpoint==='vcs/commit-compare'));
   else if(navigationCalls.some(x=>x.endpoint==='vcs/commit-compare')||button('modified · file.txt').getAttribute('aria-pressed')!=='false')throw Error('Unmatched navigation selected a file');
   const comparisons=navigationCalls.filter(x=>x.endpoint==='vcs/commit-compare').length;
   const parent=host.querySelector('select[aria-label=commitParent]');parent.value='1';parent.dispatchEvent(new Event('change',{bubbles:true}));
   await wait(()=>navigationCalls.some(x=>x.endpoint==='vcs/commit'&&x.p.parentIndex===1)&&button('modified · file.txt'));
   if(navigationCalls.filter(x=>x.endpoint==='vcs/commit-compare').length!==comparisons||button('modified · file.txt').getAttribute('aria-pressed')!=='false')throw Error('Parent change reapplied navigation hint');
  }
  for(const language of ['zh','en']){
   root.render(<CommitDetails key={language} sessionId="s" repositoryId="r" commit={b} t={k=>locales[language][k]} onRediscover={()=>{}} rpc={async(endpoint,p,signal)=>endpoint==='vcs/commit'?{...row(b,'Large body'),parents:[],parent:null,message:'',messageTruncated:true,changes:[{id:'d'.repeat(64),path:'file.txt',status:'modified'}]}:rpc(endpoint,p,signal)}/>);
   await wait(()=>host.textContent.includes(locales[language].commitMessageLimit));
   if(host.querySelector('pre')||!button('modified · file.txt'))throw Error('Omitted message hid files or rendered body');
   button('modified · file.txt').click();await wait(()=>host.querySelector('.vcs-text-comparison'));
   if(!host.textContent.includes(locales[language].commitMessageLimit))throw Error('Omission notice lost after selecting file');
  }
  let detailIdentity={sessionId:'direct',repositoryId:'r',commit:a};const directCalls=[];
  const directRpc=(endpoint,p,signal)=>{directCalls.push({endpoint,p,signal});return rpc(endpoint,p,signal);};
  const renderDetails=()=>root.render(<CommitDetails {...detailIdentity} rpc={directRpc} t={k=>k} onRediscover={()=>{}}/>);
  renderDetails();await wait(()=>host.querySelector('select[aria-label="commitParent"]'));
  for(const patch of [{sessionId:'next'},{repositoryId:'next'},{commit:b}]){
   const select=host.querySelector('select[aria-label="commitParent"]');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));
   await wait(()=>directCalls.at(-1)?.p.parentIndex===1&&button('modified · file.txt'));button('modified · file.txt').click();await wait(()=>host.querySelector('.vcs-text-comparison'));
   const previous=directCalls.slice(),count=directCalls.length;detailIdentity={...detailIdentity,...patch};renderDetails();
   await wait(()=>directCalls.length>count&&button('modified · file.txt'));
   const fresh=directCalls.slice(count);if(fresh.length!==1||fresh[0].endpoint!=='vcs/commit'||fresh[0].p.parentIndex!==0||host.querySelector('.vcs-text-comparison'))throw Error('Direct commit identity retained parent or selection');
   if(previous.some(x=>!x.signal.aborted))throw Error('Direct commit identity kept old request alive');
  }
  const pending=[],scopedCalls=[];
  const scopedRpc=async(endpoint,p,signal)=>{
   scopedCalls.push({endpoint,p,signal});
   if(endpoint!=='vcs/history')return rpc(endpoint,p,signal);
   if(p.offset)return new Promise(resolve=>pending.push({resolve,signal}));
   return {snapshot:a,commits:[row(a,'scope start')],nextOffset:50};
  };
  const renderScope=(sessionId,repositoryId)=>root.render(<HistoryPanel {...{sessionId,repositoryId}} rpc={scopedRpc} t={k=>k} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>);
  renderScope('one','r');await wait(()=>button('scope start'));
  for(const [sessionId,repositoryId] of [['two','r'],['two','other']]){
   button('scope start').click();await wait(()=>host.querySelector('[aria-label=commitDetails]'));
   button('historyGraph').click();await wait(()=>host.querySelector('[aria-label=historyGraph] [aria-current=true]'));
   const count=pending.length;button('historyMore').click();await wait(()=>pending.length>count);const old=pending.at(-1);
   renderScope(sessionId,repositoryId);await wait(()=>old.signal.aborted&&scopedCalls.some(x=>x.p.sessionId===sessionId&&x.p.repositoryId===repositoryId&&x.endpoint==='vcs/history'));
   const request=scopedCalls.find(x=>x.p.sessionId===sessionId&&x.p.repositoryId===repositoryId&&x.endpoint==='vcs/history');
   if(request.p.offset!==0||Object.hasOwn(request.p,'snapshot')||host.querySelector('[aria-label=commitDetails]'))throw Error('Scope switch retained history cursor or selection');
   if(host.querySelector('[aria-label=historyGraph]')||button('historyGraph')?.getAttribute('aria-expanded')!=='false')throw Error('Scope switch retained open graph or current marker');
   old.resolve({snapshot:a,commits:[row(c,'STALE PAGE')],nextOffset:null});await new Promise(r=>setTimeout(r,50));if(host.textContent.includes('STALE PAGE'))throw Error('Stale page survived scope switch');
   await wait(()=>button('scope start'));
  }
  const fileCalls=[],filePending=[];let identity={sessionId:'s',repositoryId:'r',commit:a,parentIndex:0,id:'d'.repeat(64)};
  const fileRpc=async(endpoint,p,signal)=>{
   if(endpoint!=='vcs/file-history')throw Error('Unexpected file history endpoint');fileCalls.push(p);
   if(p.offset)return new Promise(resolve=>filePending.push({resolve,signal}));
   return {path:'file.txt',commits:[row(b,'file row')],nextOffset:50};
  };
  const renderFile=()=>root.render(<FileHistory {...identity} rpc={fileRpc} t={k=>k} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>);
  renderFile();await wait(()=>button('fileHistory'));
  for(const patch of [{sessionId:'other'},{repositoryId:'other'},{commit:b},{parentIndex:1},{id:'e'.repeat(64)}]){
   button('fileHistory').click();await wait(()=>button('historyMore'));const count=filePending.length;button('historyMore').click();await wait(()=>filePending.length>count);const old=filePending.at(-1),requests=fileCalls.length;
   identity={...identity,...patch};renderFile();await wait(()=>old.signal.aborted&&button('fileHistory')?.getAttribute('aria-expanded')==='false');
   old.resolve({path:'OLD PATH',commits:[row(c,'OLD FILE PAGE')],nextOffset:null});await new Promise(r=>setTimeout(r,50));
   if(fileCalls.length!==requests||host.textContent.includes('OLD FILE PAGE')||host.querySelector('section'))throw Error('File identity switch kept page or fetched automatically');
  }
  button('fileHistory').click();await wait(()=>host.querySelector('section')?.getAttribute('aria-busy')==='false');if(fileCalls.at(-1).offset!==0||fileCalls.at(-1).id!==identity.id)throw Error('New file reused old cursor');
 }finally{root.unmount();host.remove();}
}
