import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {apply} from '../src/client.jsx';
import locales from '../src/locales.json';
export async function checkReviewViews(){
 const host=document.createElement('div');host.style.cssText='height:720px;width:1000px';document.body.appendChild(host);const root=createRoot(host);
 const wait=async fn=>{for(let i=0;i<240;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Top-level review view timeout: '+host.textContent.slice(-1500));};
 try{for(const language of ['zh','en']){
  let Page,pending;const calls=[],a='a'.repeat(40),b='b'.repeat(40),id='d'.repeat(64),t=k=>locales[language][k]||k;
  const value=async(endpoint,p,signal)=>{
   calls.push({endpoint,p});
   if(endpoint==='vcs/repositories')return {cwd:'/fixture',repositories:[{id:'repo',type:'git',root:'/fixture'}]};
   if(endpoint==='vcs/status')return {changes:[{id:'local',path:'same.txt',status:'modified'}]};
   if(endpoint==='vcs/compare')return new Promise(resolve=>pending={resolve,signal});
   if(endpoint==='vcs/history')return {snapshot:a,nextOffset:null,commits:Array.from({length:50},(_,i)=>({id:i===0?a:i.toString(16).padStart(40,'0'),subject:i===0?'COMMITTED SUBJECT':'ROW '+i,author:'author',date:'2026-10-08',parents:[b]}))};
   if(endpoint==='vcs/commit')return {id:a,subject:'COMMITTED SUBJECT',parents:[b],parent:b,changes:[{id,path:'same.txt',status:'modified'}]};
   if(endpoint==='vcs/commit-compare')return {path:'same.txt',left:{label:b,text:'COMMITTED BEFORE'},right:{label:a,text:'COMMITTED AFTER'}};
   throw Error('Unexpected top-level RPC '+endpoint);
  };
  apply({effect:fn=>fn(),locale:{register:()=>{},bind:()=>t,subscribe:()=>()=>{},getSnapshot:()=>language},layout:{selectPanel:()=>{}},slots:{inject:(_name,fn)=>fn(),register:(spec,component)=>{if(spec.key==='local-vcs')Page=component;}},connection:{rpc:{call:async(_route,endpoint,p,signal)=>({ok:true,value:await value(endpoint,p,signal)})}}});
  flushSync(()=>root.render(<Page key={language} useSessions={select=>select({byId:{s:{id:'s',cwd:'/fixture',retainedBy:{mainView:1}}}})}/>));
  await wait(()=>host.querySelector('.vcs-file'));host.querySelector('.vcs-file').click();await wait(()=>pending);
  const old=pending;const button=text=>[...host.querySelectorAll('button')].find(node=>node.textContent===text);
  button(t('history')).click();await wait(()=>button('COMMITTED SUBJECT')&&old.signal.aborted);
  if(getComputedStyle(host.querySelector('.vcs-body')).display!=='none')throw Error('Local workspace still visible in history mode');
  old.resolve({path:'same.txt',left:{label:'HEAD',text:'LOCAL BEFORE'},right:{label:'WORKING',text:'LOCAL AFTER'}});
  button('COMMITTED SUBJECT').click();await wait(()=>[...host.querySelectorAll('.vcs-history button')].some(node=>node.textContent==='modified · same.txt'));
  const file=[...host.querySelectorAll('.vcs-history button')].find(node=>node.textContent==='modified · same.txt');
  const bounds=host.querySelector('.vcs-history').getBoundingClientRect(),rect=file.getBoundingClientRect();
  if(rect.top<bounds.top||rect.bottom>bounds.bottom||rect.left<bounds.left||rect.right>bounds.right)throw Error('Selected commit files are outside history viewport with 50 rows');
  const list=host.querySelector('.vcs-history-list');list.scrollTop=list.scrollHeight;
  if(file.getBoundingClientRect().top!==rect.top)throw Error('History list scrolling moves commit files out of view');
  file.click();await wait(()=>host.querySelector('.vcs-history').textContent.replaceAll('\u00a0',' ').includes('COMMITTED AFTER'));
  if(host.querySelector('.vcs-history').textContent.includes('LOCAL AFTER')||getComputedStyle(host.querySelector('.vcs-history')).maxHeight!=='none')throw Error('History body contaminated or capped');
  const request=calls.find(c=>c.endpoint==='vcs/commit-compare');if(request.p.commit!==a||request.p.parentIndex!==0||request.p.id!==id||calls.filter(c=>c.endpoint==='vcs/compare').length!==1)throw Error('Historical comparison used local identity');
  const detail=host.querySelector('.vcs-history-details'),editor=detail.querySelector('.monaco-diff-editor'),count=calls.length,statusCount=calls.filter(c=>c.endpoint==='vcs/status').length;
  for(let i=0;i<20;i++)file.dispatchEvent(new FocusEvent('focus',{bubbles:true}));
  await new Promise(r=>setTimeout(r,100));if(calls.length!==count)throw Error('Descendant focus triggered refresh');
  window.dispatchEvent(new FocusEvent('focus'));await wait(()=>calls.filter(c=>c.endpoint==='vcs/status').length===statusCount+1);
  await new Promise(r=>setTimeout(r,100));
  if(host.querySelector('.vcs-history-details')!==detail||detail.querySelector('.monaco-diff-editor')!==editor||calls.filter(c=>c.endpoint==='vcs/commit-compare').length!==1)throw Error('Window focus remounted historical review');
  for(const key of ['fileHistory','blame','imageCompare']){const controls=[...detail.querySelectorAll('button')].filter(b=>b.textContent===t(key));if(controls.length>1)throw Error('Duplicate historical controls: '+key+' count='+controls.length+' html='+detail.innerHTML.slice(-6000));}
  button(t('workspaceView')).click();await wait(()=>!host.querySelector('.vcs-history')&&getComputedStyle(host.querySelector('.vcs-body')).display!=='none');
  if(calls.filter(c=>c.endpoint==='vcs/compare').length!==1)throw Error('Returning to workspace revived old selection');
 }
 }finally{root.unmount();host.remove();}
}
