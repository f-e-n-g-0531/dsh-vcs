import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import SvnHistory from '../src/SvnHistory.jsx';
export async function checkSvnHistoryDateFilter(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const wait=async(fn,label)=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('SVN history date filter timeout at '+label);};
 const entries=[{revision:'3',message:'m3',date:'2024-06-15T12:00:00.000000Z'},{revision:'2',message:'m2',date:'2023-12-31T23:59:59.000000Z'},{revision:'1',message:'m1',date:'2022-01-01T00:00:00.000000Z'}];
 const rpc=async(e,p,signal)=>{if(e!=='vcs/svn-log')throw Error('Unexpected '+e);return {entries,nextRevision:null};};
 const t=k=>k,buttons=()=>[...host.querySelectorAll('button')],byText=s=>buttons().find(b=>b.textContent.includes(s));
 const type=key=>{const input=host.querySelector('[aria-label="'+key+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');
  return value=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(host.querySelector('[aria-label="'+key+'"]'),value);host.querySelector('[aria-label="'+key+'"]').dispatchEvent(new Event('input',{bubbles:true}));};};
 const setSince=()=>{const input=host.querySelector('[aria-label="historyServer_since"]');return v=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,v);input.dispatchEvent(new Event('input',{bubbles:true}));};};
 try{
  flushSync(()=>root.render(<SvnHistory sessionId='s' repositoryId='r' token={'b'.repeat(64)} snapshot='3' rpc={rpc} t={t} onRediscover={()=>{}}/>));
  await wait(()=>byText('r3 · m3')&&byText('r2 · m2')&&byText('r1 · m1'),'all-loaded');
  setSince()('2024-06-02');await wait(()=>byText('r3 · m3')&&!byText('r2 · m2')&&!byText('r1 · m1'),'since-filter');
  setSince()('2099-01-01');await wait(()=>!byText('r3 · m3')&&host.textContent.includes('historyNoMatch'),'empty-filter');
  setSince()('not-a-date');await wait(()=>host.querySelector('[role="alert"]'),'invalid-bound');
  setSince()('');await wait(()=>byText('r3 · m3')&&byText('r2 · m2')&&byText('r1 · m1'),'cleared');
 }finally{root.unmount();host.remove();}
}
