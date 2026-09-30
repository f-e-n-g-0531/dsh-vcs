import React from 'react';
import {createRoot} from 'react-dom/client';
import RevisionPanel from '../src/RevisionPanel.jsx';
import HistoryPanel from '../src/HistoryPanel.jsx';
export async function checkRevisions(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const a='a'.repeat(40),b='b'.repeat(40);let delayed,oldSignal,refLoads=0,refResolve,refSignal;const calls=[];
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Revision UI timeout');};
 const button=text=>[...host.querySelectorAll('button')].find(n=>n.textContent.includes(text));
 const rpc=async(endpoint,p,signal)=>{
  calls.push({endpoint,p});
  if(endpoint==='vcs/references'){refLoads++;if(refLoads>=5){refSignal=signal;return new Promise(resolve=>refResolve=resolve);}if(refLoads===3)throw Error('refs unavailable');if(refLoads===4)return {references:[]};return {references:[{name:'refs/heads/topic',commit:(refLoads===1?'e':'f').repeat(40),kind:'branch'}]};}
  if(endpoint==='vcs/revision-changes'){
   if(p.base===p.target)return {changes:[]};
   if(p.base===b){oldSignal=signal;return new Promise(resolve=>delayed=resolve);}
   return {changes:[{id:'c'.repeat(64),path:'pair.txt',oldPath:'original.txt',status:'renamed'}]};
  }
  if(endpoint!=='vcs/revision-compare'||p.base!==a||p.target!==b)throw Error('Unexpected comparison pair');
  return {path:'pair.txt',left:{text:'left revision',label:a},right:{text:'right revision',label:b}};
 };
 const choose=(i,value)=>{const select=host.querySelectorAll('select')[i];select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));};
 try{
 root.render(<RevisionPanel commits={[{id:a,subject:'first'},{id:b,subject:'second'}]} sessionId="s" repositoryId="r" rpc={rpc} t={key=>key} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>);
 await wait(()=>host.querySelectorAll('select').length===2);choose(0,a);choose(1,b);
 await wait(()=>button('pair.txt'));button('pair.txt').click();await wait(()=>host.textContent.includes('right revision'));
 const input=host.querySelector('input'),countBefore=calls.length;
 const enter=value=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
 enter('no-match');await wait(()=>host.textContent.includes('emptySearch'));
 if(host.textContent.includes('right revision'))throw Error('Filtered Diff retained');
 enter('original');await wait(()=>button('pair.txt'));if(calls.length!==countBefore)throw Error('Filter issued RPC');
 button('pair.txt').click();await wait(()=>host.textContent.includes('right revision'));
 button('revisionSwap').click();await wait(()=>delayed);
 if(host.textContent.includes('right revision'))throw Error('Old Diff remained after swap');
 const selects=host.querySelectorAll('select');if(selects[0].value!==b||selects[1].value!==a)throw Error('Swap failed');
 choose(0,a);await wait(()=>host.textContent.includes('revisionEmpty'));
 if(!oldSignal.aborted)throw Error('Superseded request not aborted');
 delayed({changes:[{id:'d'.repeat(64),path:'STALE.txt',status:'modified'}]});
 await new Promise(r=>setTimeout(r,50));if(host.textContent.includes('STALE'))throw Error('Stale response rendered');
 if(calls.length!==5)throw Error('Unexpected revision RPC count: '+calls.length);
 if(refLoads)throw Error('References fetched without opt-in');
 if(host.querySelectorAll('optgroup[label=revisionLoadedCommits]').length!==2||host.querySelector('optgroup[label=revisionLocalRefs]'))throw Error('Initial revision option groups incorrect');
 const hasOption=id=>[...host.querySelectorAll('option')].some(o=>o.value===id);
 button('revisionLoadRefs').click();await wait(()=>hasOption('e'.repeat(40)));
 if(host.querySelectorAll('optgroup[label=revisionLocalRefs]').length!==2)throw Error('Loaded references not grouped');
 if(!host.textContent.includes('revisionRefsCount: 1'))throw Error('Missing loaded reference count');
 choose(0,'e'.repeat(40));await wait(()=>button('pair.txt'));const pinned=calls.at(-1);if(pinned.p.base!=='e'.repeat(40)||pinned.p.target!==a)throw Error('Reference comparison did not pin OID');
 const comparisons=calls.filter(c=>c.endpoint==='vcs/revision-changes').length;
 button('revisionLoadRefs').click();await wait(()=>hasOption('f'.repeat(40)));
 if(host.querySelectorAll('select')[0].value!=='e'.repeat(40)||calls.filter(c=>c.endpoint==='vcs/revision-changes').length!==comparisons)throw Error('Moving reference changed pinned comparison');
 button('revisionLoadRefs').click();await wait(()=>host.textContent.includes('refs unavailable'));if(host.querySelectorAll('select')[0].value!=='e'.repeat(40))throw Error('Reference failure cleared selection');
 button('revisionLoadRefs').click();await wait(()=>refLoads===4&&host.textContent.includes('revisionRefsEmpty'));
 if(host.querySelectorAll('select')[0].value!=='e'.repeat(40))throw Error('Empty references cleared pinned selection');
 if(host.querySelector('optgroup[label=revisionLocalRefs]')||host.querySelectorAll('select')[0].selectedOptions[0].parentElement.tagName!=='SELECT')throw Error('Pinned fallback lost after empty reference refresh');
 button('revisionLoadRefs').click();await wait(()=>refResolve);
 for(const [sessionId,repositoryId] of [['other','r'],['other','new-repo']]){
  const oldResolve=refResolve,signal=refSignal,count=calls.length;
  root.render(<RevisionPanel commits={[{id:a,subject:'first'}]} sessionId={sessionId} repositoryId={repositoryId} rpc={rpc} t={key=>key} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>);
  await wait(()=>signal.aborted);
  if([...host.querySelectorAll('select')].some(s=>s.value)||hasOption('f'.repeat(40))||hasOption('e'.repeat(40))||button('pair.txt')||calls.length!==count)throw Error('Scope change retained selections or auto-loaded refs');
  oldResolve({references:[{name:'refs/heads/STALE-REF',commit:'d'.repeat(40)}]});await new Promise(r=>setTimeout(r,50));if(host.textContent.includes('STALE-REF'))throw Error('Late refs survived scope change');
  refResolve=null;button('revisionLoadRefs').click();await wait(()=>refResolve);
 }
 root.render(null);await wait(()=>refSignal.aborted);refResolve({references:[]});
 const emptyCalls=[];
 const emptyRpc=async(endpoint,p,signal)=>{
  emptyCalls.push({endpoint,p});
  if(endpoint==='vcs/history')return {commits:[],snapshot:null,nextOffset:null};
  if(endpoint==='vcs/references')return {references:[{name:'refs/tags/old',kind:'tag',commit:a},{name:'refs/heads/topic',kind:'branch',commit:b}]};
  return rpc(endpoint,p,signal);
 };
 root.render(<HistoryPanel sessionId="empty" repositoryId="r" rpc={emptyRpc} t={key=>key} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>);
 await wait(()=>host.textContent.includes('historyEmpty'));
 if(!button('revisionLoadRefs')||emptyCalls.length!==1||emptyCalls[0].endpoint!=='vcs/history')throw Error('Empty history hid revision entry or fetched refs automatically');
 button('revisionLoadRefs').click();await wait(()=>hasOption(a)&&hasOption(b));choose(0,a);choose(1,b);
 await wait(()=>button('pair.txt'));button('pair.txt').click();await wait(()=>host.textContent.includes('right revision'));
 if(emptyCalls.filter(c=>c.endpoint==='vcs/history').length!==1||!emptyCalls.some(c=>c.endpoint==='vcs/revision-compare'&&c.p.base===a&&c.p.target===b))throw Error('Empty HEAD comparison lost pinned reference pair');
 }finally{root.unmount();host.remove();}
}
