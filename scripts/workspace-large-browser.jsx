import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {apply} from '../src/client.jsx';import locales from '../src/locales.json';
export async function checkWorkspaceLarge(){
 const host=document.createElement('div');host.style.cssText='height:720px;width:1000px';document.body.appendChild(host);const root=createRoot(host);
 const wait=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Workspace large UI timeout '+host.textContent.slice(-700));};
 try{for(const lang of ['zh','en']){
  let Page,pending,mode='normal';const calls=[],t=k=>locales[lang][k]||k;
  const text=('line '+ 'x'.repeat(110)+'\n').repeat(24000);
  const rpc=async(e,p,signal)=>{
   if(e==='vcs/repositories')return {cwd:'/fixture',repositories:[{id:'r',type:'git',root:'/fixture'}]};
   if(e==='vcs/status')return {changes:[{id:'a'.repeat(64),path:'large.txt',status:'modified'}]};
   if(e==='vcs/compare'){
    calls.push({p,signal});if(!p.large)return {path:'large.txt',left:{text:'',label:'HEAD'},right:{text:'',label:'Working tree'},notice:'File exceeds the 2 MiB preview limit.'};
    const data={path:'large.txt',large:true,left:{text,label:'HEAD'},right:{text:text+'EOF CHANGE\n',label:'Working tree'}};
    if(mode==='pending')return new Promise(resolve=>pending=()=>resolve(data));return data;
   }throw Error('Unexpected workspace fixture RPC '+e);
  };
  apply({effect:fn=>fn(),locale:{register:()=>{},bind:()=>t,subscribe:()=>()=>{},getSnapshot:()=>lang},layout:{selectPanel:()=>{}},slots:{inject:(_n,fn)=>fn(),register:(spec,component)=>{if(spec.key==='local-vcs')Page=component;}},connection:{rpc:{call:async(_route,e,p,s)=>({ok:true,value:await rpc(e,p,s)})}}});
  flushSync(()=>root.render(<Page key={lang} useSessions={select=>select({byId:{s:{id:'s',cwd:'/fixture',retainedBy:{mainView:1}}}})}/>));
  const button=k=>[...host.querySelectorAll('button')].find(n=>n.textContent===t(k));
  await wait(()=>host.querySelector('.vcs-file'));host.querySelector('.vcs-file').click();await wait(()=>button('largeLoad'));if(calls.some(c=>c.p.large))throw Error('Large automatically loaded');
  button('largeLoad').click();await wait(()=>host.textContent.includes(t('diffComplete')));if(!host.querySelector('.monaco-diff-editor')||!calls.at(-1).p.large)throw Error('Advanced full workspace Diff absent');
  button('largeClose').click();await wait(()=>button('largeLoad'));mode='pending';button('largeLoad').click();await wait(()=>pending);const old=calls.at(-1);
  const selector=host.querySelector('select[aria-label="'+t('gitMode')+'"]');selector.value='staged';selector.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>old.signal.aborted);pending();await wait(()=>!button('largeClose'));if(host.textContent.includes(t('diffComplete')))throw Error('Late workspace result revived');
 }}finally{root.unmount();host.remove();}
}
