import React from 'react';
import {createRoot} from 'react-dom/client';
import RevisionPanel from '../src/RevisionPanel.jsx';
export async function checkRevisions(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const a='a'.repeat(40),b='b'.repeat(40);let delayed,oldSignal;const calls=[];
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Revision UI timeout');};
 const button=text=>[...host.querySelectorAll('button')].find(n=>n.textContent.includes(text));
 const rpc=async(endpoint,p,signal)=>{
  calls.push({endpoint,p});
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
 }finally{root.unmount();host.remove();}
}
