import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import FileHistory from '../src/FileHistory.jsx';import locales from '../src/locales.json';
export async function checkFileHistoryDate(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);const wait=async(fn,label)=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('File history date timeout at '+label);};
 try{for(const lang of ['zh','en']){
  const t=k=>locales[lang][k],calls=[];
  const rpc=(endpoint,p,signal)=>{if(endpoint!=='vcs/file-history')throw Error('Unexpected endpoint');calls.push({p,signal});return Promise.resolve({path:'中文.txt',commits:[{id:'c'.repeat(40),subject:'edited',author:'A',date:'2026-01-01T00:00:00Z'}],nextOffset:null});};
  flushSync(()=>root.render(<FileHistory key={lang} sessionId='s' repositoryId='r' commit={'a'.repeat(40)} parentIndex={0} id={'b'.repeat(64)} {...{rpc,t}} onRediscover={()=>{}}/>));
  const btn=[...host.querySelectorAll('button')].find(b=>b.textContent===t('fileHistory'));btn.click();await wait(()=>calls.length===1,'initial-load');
  const sinceInput=host.querySelector('[aria-label="'+t('historyServer_since')+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(sinceInput,'2024-01-01');sinceInput.dispatchEvent(new Event('input',{bubbles:true}));
  await wait(()=>calls.length===2&&calls[1].p.since==='2024-01-01','date-forward');
  if(calls[1].p.follow!==false)throw Error('Follow default changed');
  if(!host.textContent.includes(t('fileHistoryDateScope')))throw Error('Date scope missing');
 }}finally{root.unmount();host.remove();}
}
