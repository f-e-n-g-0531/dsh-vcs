import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {apply} from '../src/client-bootstrap.jsx';
import {loadFrontend} from '../src/frontend-loader.mjs';
import dictionaries from '../src/locales.json';
export async function checkFrontendReload(){
 const host=document.createElement('div');host.style.cssText='height:720px;width:1100px';document.body.append(host);const root=createRoot(host),effects=[],navigation=[];let Page,calls=0,disposed=0,mode='success',pending;
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Reload browser timeout: '+host.textContent.slice(0,500));};
 const ctx={effect:fn=>effects.push(fn),locale:{register:()=>()=>{},bind:()=>k=>dictionaries.zh[k]||k,subscribe:()=>()=>{},getSnapshot:()=>1},slots:{inject:(_s,fn)=>fn(),register:(spec,component)=>{if(spec.key==='local-vcs')Page=component;}},layout:{selectPanel:p=>navigation.push(p)},connection:{rpc:{call:async(_r,e,p,signal)=>{calls++;if(e==='vcs/repositories')return {ok:true,value:{cwd:'/fixture',repositories:[]}};throw Error('Unexpected RPC');}}}};
 let imported=0;const loader=async options=>{
  if(mode==='pending')return new Promise(resolve=>pending={resolve,signal:options.signal});
  if(mode==='backend')throw Object.assign(Error('changed'),{code:'restart-required'});
  if(mode==='failure')throw Error('network');
  if(mode==='broken')return {manifest:{version:'0.3.106'},ui:{dictionaries,createPage:()=>()=>{throw Error('Broken UI');}}};
  const data={protocol:1,version:'0.3.105',backend:'a'.repeat(64),runningBackend:'a'.repeat(64),interface:'b'.repeat(64)};
  const result=await loadFrontend({...options,fetcher:async()=>Response.json(data),importer:async()=>{imported++;return import('../dist/interface.js?browser-reload-test');}});
  const createPage=result.ui.createPage;result.ui.createPage=(context,options)=>{const Actual=createPage(context,options);return function Loaded(props){useEffect(()=>()=>{disposed++;},[]);return <Actual {...props}/>;};};return result;
 };
 const expectedError=e=>{if(mode==='broken'&&String(e.message).includes('Broken UI')){e.preventDefault();e.stopImmediatePropagation();}};window.addEventListener('error',expectedError,true);
 const button=key=>[...host.querySelectorAll('button')].find(n=>n.textContent===dictionaries.zh[key]);
 try{
  apply(ctx,{loader});for(const fn of effects)fn();flushSync(()=>root.render(<Page useSessions={select=>select({byId:{s:{id:'s',cwd:'/fixture',retainedBy:{mainView:1}}}})}/>));
  await wait(()=>calls>0);button('updatePlugin').click();await wait(()=>button('updateManager'));button('updateManager').click();if(navigation[0]!=='plugins')throw Error('Wrong plugin manager panel');
  const before=calls;button('reloadInterface').click();await wait(()=>host.textContent.includes('VCS 0.3.105'));if(imported!==1||calls<=before)throw Error('Actual interface did not remount');
  mode='backend';button('reloadInterface').click();await wait(()=>host.textContent.includes(dictionaries.zh.reloadRestart));if(disposed||!host.textContent.includes('VCS 0.3.105'))throw Error('Backend mismatch disposed live UI');
  mode='failure';button('reloadInterface').click();await wait(()=>host.textContent.includes('network'));if(disposed)throw Error('Failed fetch disposed live UI');
  mode='broken';button('reloadInterface').click();await wait(()=>host.querySelector('[role=alert]'));button('retry').click();await wait(()=>host.querySelector('.vcs-root'));if(!host.textContent.includes('VCS 0.3.105'))throw Error('Restore lost previous UI');
  mode='pending';button('reloadInterface').click();await wait(()=>pending);root.unmount();if(!pending.signal.aborted)throw Error('Unmount did not cancel reload');pending.resolve({ui:{},manifest:{}});
 }finally{window.removeEventListener('error',expectedError,true);root.unmount();host.remove();}
}
