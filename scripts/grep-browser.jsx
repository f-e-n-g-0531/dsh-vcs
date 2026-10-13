import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import GrepPanel from '../src/GrepPanel.jsx';
export async function checkGrep(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const wait=async(fn,label)=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Grep timeout at '+label);};
 let pending,oldSignal;
 const rpc=async(e,p,signal)=>{
  if(e!=='vcs/grep')throw Error('Unexpected '+e);
  if(p.query==='pending'){oldSignal=signal;return new Promise(resolve=>pending=resolve);}
  return {matches:[{path:'f.js',line:3,text:'foo bar'}]};
 };
 const t=k=>k;
 try{
  flushSync(()=>root.render(<GrepPanel sessionId='s' repositoryId='r' rpc={rpc} t={t} onRediscover={()=>{}}/>));
  const input=host.querySelector('[aria-label="grepQuery"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'foo');
  input.dispatchEvent(new Event('input',{bubbles:true}));
  await wait(()=>host.querySelector('button[type=submit]')&&!host.querySelector('button[type=submit]').disabled,'submit-ready');
  host.querySelector('button[type=submit]').click();
  await wait(()=>host.textContent.includes('f.js:3'),'match-shown');
  if(!host.textContent.includes('foo bar'))throw Error('match text missing');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'pending');
  input.dispatchEvent(new Event('input',{bubbles:true}));
  await wait(()=>!host.querySelector('button[type=submit]').disabled,'next-submit');
  host.querySelector('button[type=submit]').click();await wait(()=>pending,'pending-request');
  flushSync(()=>root.render(<GrepPanel sessionId='s' repositoryId='other' rpc={rpc} t={t} onRediscover={()=>{}}/>));
  if(!oldSignal.aborted)throw Error('Repository switch did not cancel search');
  if(host.querySelector('input').value!==''||host.textContent.includes('f.js:3'))throw Error('Old search state retained');
  pending({matches:[{path:'stale.js',line:1,text:'late old result'}]});
  await new Promise(r=>setTimeout(r,30));
  if(host.textContent.includes('stale.js'))throw Error('Late old-repository result rendered');
 }finally{root.unmount();host.remove();}
}