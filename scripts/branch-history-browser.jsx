import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import HistoryPanel from '../src/HistoryPanel.jsx';
import locales from '../src/locales.json';
export async function checkBranchHistory(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40);
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Branch history timeout');};
 try{for(const lang of ['zh','en'])for(const reference of ['refs/heads/topic','refs/remotes/origin/topic','refs/remotes/origin/HEAD']){
  const calls=[],t=k=>locales[lang][k];let refLoads=0;
  const rpc=async(endpoint,p,signal)=>{calls.push({endpoint,p,signal});if(endpoint==='vcs/references')return {references:[{name:reference,commit:++refLoads===1?b:c}]};if(endpoint==='vcs/history')return {snapshot:p.snapshot||a,commits:[],nextOffset:p.snapshot===b&&!p.offset?50:null};throw Error('Unexpected branch RPC');};
  flushSync(()=>root.render(<HistoryPanel key={lang+reference} sessionId='s' repositoryId='r' {...{rpc,t}} onRediscover={()=>{}}/>));
  const button=k=>[...host.querySelectorAll('button')].find(n=>n.textContent===t(k));
  await wait(()=>!host.querySelector('fieldset').disabled);button('revisionLoadRefs').click();await wait(()=>refLoads===1&&host.querySelector('[aria-label="'+t('historyBranch')+'"]').options.length===2);
  const select=host.querySelector('[aria-label="'+t('historyBranch')+'"]');select.value=JSON.stringify([reference,b]);select.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>calls.filter(x=>x.endpoint==='vcs/history').length===2&&!select.disabled);
  if(calls.at(-1).p.snapshot!==b||calls.at(-1).p.offset!==0)throw Error('Reference tip not pinned');
  await wait(()=>button('historyMore')&&!button('historyMore').disabled);button('historyMore').click();await wait(()=>calls.filter(x=>x.endpoint==='vcs/history').length===3&&!select.disabled);if(calls.at(-1).p.snapshot!==b||calls.at(-1).p.offset!==50)throw Error('Branch page moved');
  const count=calls.filter(x=>x.endpoint==='vcs/history').length;button('revisionLoadRefs').click();await wait(()=>refLoads===2&&select.options.length===3);
  if(select.value!==JSON.stringify([reference,b])||calls.filter(x=>x.endpoint==='vcs/history').length!==count)throw Error('Ref refresh moved pinned history');
  select.value='';select.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>calls.filter(x=>x.endpoint==='vcs/history').length===count+1&&!select.disabled);if(calls.at(-1).p.snapshot!==undefined)throw Error('HEAD navigation reused branch snapshot');
 }}finally{root.unmount();host.remove();}
}
