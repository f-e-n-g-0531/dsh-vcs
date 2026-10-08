import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import HistoryPanel from '../src/HistoryPanel.jsx';
import locales from '../src/locales.json';
export async function checkHistorySearch(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),a='a'.repeat(40),b='b'.repeat(40);
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('History search timeout');};
 try{for(const lang of ['zh','en']){
  const calls=[],t=k=>locales[lang][k],row=id=>({id,subject:'result '+id[0],author:'author',date:'2026-10-08',parents:[]});
  const rpc=async(endpoint,p,signal)=>{if(endpoint!=='vcs/history')throw Error('Unexpected search RPC');calls.push({p,signal});return {snapshot:a,commits:[row(p.offset?b:a)],nextOffset:p.search&&!p.offset?50:null};};
  flushSync(()=>root.render(<HistoryPanel key={lang} sessionId='s' repositoryId='r' {...{rpc,t}} onRediscover={()=>{throw Error('Rediscovery');}}/>));
  await wait(()=>calls.length===1&&!host.querySelector('fieldset').disabled);
  const input=host.querySelector('[aria-label="'+t('historyServer_message')+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'needle .*');input.dispatchEvent(new Event('input',{bubbles:true}));
  await new Promise(r=>setTimeout(r,50));if(calls.length!==1)throw Error('Draft typing queried server');
  const button=k=>[...host.querySelectorAll('button')].find(n=>n.textContent===t(k));button('historyServerApply').click();await wait(()=>calls.length===2&&!host.querySelector('fieldset').disabled);
  if(calls[1].p.snapshot!==a||calls[1].p.offset!==0||calls[1].p.search.message!=='needle .*'||!calls[0].signal.aborted)throw Error('Search did not pin/reset/cancel');
  button('historyMore').click();await wait(()=>calls.length===3&&!host.querySelector('fieldset').disabled);
  if(calls[2].p.snapshot!==a||calls[2].p.offset!==50||calls[2].p.search.message!=='needle .*')throw Error('Search pagination lost scope');
  button('historyServerClear').click();await wait(()=>calls.length===4&&!host.querySelector('fieldset').disabled);
  if(calls[3].p.offset!==0||calls[3].p.snapshot!==a||Object.keys(calls[3].p.search).length||input.value)throw Error('Clear query lost pinned snapshot');
 }}finally{root.unmount();host.remove();}
}
