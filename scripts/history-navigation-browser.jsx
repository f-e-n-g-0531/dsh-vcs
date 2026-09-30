import React from 'react';
import {createRoot} from 'react-dom/client';
import HistoryPanel from '../src/HistoryPanel.jsx';
import CommitDetails from '../src/CommitDetails.jsx';
import locales from '../src/locales.json';
export async function checkHistoryNavigation(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40),calls=[];
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('History navigation timeout');};
 const button=text=>[...host.querySelectorAll('button')].find(e=>e.textContent===text);
 const row=(id,subject)=>({id,subject,author:'Author',date:'2026-09-29T00:00:00Z',parents:[]});
 const message='Subject\n\n中文正文\n<img src=x onerror=alert(1)>\nTrailer: value';
 const rpc=async(endpoint,p,signal)=>{
  calls.push({endpoint,p,signal});
  if(endpoint==='vcs/history')return {snapshot:a,commits:[row(a,'start')],nextOffset:null};
  if(endpoint==='vcs/commit')return {...row(p.commit,p.commit===a?'start details':'destination details'),message:p.commit===a?message:'Destination message',parents:p.commit===a?[b,c]:[],parent:p.commit===a?[b,c][p.parentIndex]:null,changes:[{id:'d'.repeat(64),path:'file.txt',status:'modified'}]};
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
  if(calls.filter(x=>['vcs/commit-compare','vcs/file-history'].includes(x.endpoint)).some(x=>!x.signal.aborted))throw Error('Old comparison requests survived navigation');
  if(host.querySelector('select[aria-label="commitParent"]')||host.querySelector('.vcs-text-comparison'))throw Error('Old comparison state survived navigation');
  if(calls.filter(x=>x.endpoint==='vcs/history').length!==1)throw Error('Navigation reloaded pinned history');
  for(const language of ['zh','en']){
   root.render(<CommitDetails key={language} sessionId="s" repositoryId="r" commit={b} t={k=>locales[language][k]} onRediscover={()=>{}} rpc={async(endpoint,p,signal)=>endpoint==='vcs/commit'?{...row(b,'Large body'),parents:[],parent:null,message:'',messageTruncated:true,changes:[{id:'d'.repeat(64),path:'file.txt',status:'modified'}]}:rpc(endpoint,p,signal)}/>);
   await wait(()=>host.textContent.includes(locales[language].commitMessageLimit));
   if(host.querySelector('pre')||!button('modified · file.txt'))throw Error('Omitted message hid files or rendered body');
   button('modified · file.txt').click();await wait(()=>host.querySelector('.vcs-text-comparison'));
   if(!host.textContent.includes(locales[language].commitMessageLimit))throw Error('Omission notice lost after selecting file');
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
   const count=pending.length;button('historyMore').click();await wait(()=>pending.length>count);const old=pending.at(-1);
   renderScope(sessionId,repositoryId);await wait(()=>old.signal.aborted&&scopedCalls.some(x=>x.p.sessionId===sessionId&&x.p.repositoryId===repositoryId&&x.endpoint==='vcs/history'));
   const request=scopedCalls.find(x=>x.p.sessionId===sessionId&&x.p.repositoryId===repositoryId&&x.endpoint==='vcs/history');
   if(request.p.offset!==0||Object.hasOwn(request.p,'snapshot')||host.querySelector('[aria-label=commitDetails]'))throw Error('Scope switch retained history cursor or selection');
   old.resolve({snapshot:a,commits:[row(c,'STALE PAGE')],nextOffset:null});await new Promise(r=>setTimeout(r,50));if(host.textContent.includes('STALE PAGE'))throw Error('Stale page survived scope switch');
   await wait(()=>button('scope start'));
  }
 }finally{root.unmount();host.remove();}
}
