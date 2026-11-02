import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import HistoricalTree from '../src/HistoricalTree.jsx';
import FileHistory from '../src/FileHistory.jsx';
import PathHistory from '../src/PathHistory.jsx';
export async function checkHistoryTreePages(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),commit='a'.repeat(40),oid='b'.repeat(40),calls=[];
 const wait=async(fn,label)=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Tree pages timeout: '+label);};
 const t=k=>k,button=s=>[...host.querySelectorAll('button')].find(b=>b.textContent===s);let late,oldSignal;
 const rpc=async(e,p,signal)=>{
  calls.push({e,p});if(e!=='vcs/tree-page')throw Error('Tree read full recursive tree');
  if(p.path==='pending'){oldSignal=signal;return new Promise(resolve=>late=resolve);}
  const entries=p.path?[{path:p.path+'/file'+(p.query?'filtered':p.offset),mode:'100644',type:'blob',oid}]:[{path:'nested',mode:'040000',type:'tree',oid},{path:'pending',mode:'040000',type:'tree',oid}];
  return {commit,path:p.path,entries,nextOffset:p.path&&p.offset===0?100:null};
 };
 try{
  flushSync(()=>root.render(<HistoricalTree sessionId='tree' repositoryId='r' {...{commit,rpc,t}} onRediscover={()=>{}}/>));
  button('historicalTree').click();await wait(()=>button('nested/'),'root');button('nested/').click();await wait(()=>button('file0'),'directory');
  button('treeNext').click();await wait(()=>button('file100'),'next');if(!calls.some(c=>c.p.path==='nested'&&c.p.offset===100&&c.p.limit===100))throw Error('Directory offset lost');
  button('treePrevious').click();await wait(()=>button('file0'),'previous');
  const filter=host.querySelector('input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(filter,'filtered');filter.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>button('filefiltered'),'server filtered directory');if(!calls.some(c=>c.p.query==='filtered'&&c.p.offset===0))throw Error('Tree query not server scoped');
  button('treeUp').click();await wait(()=>button('pending/'),'root again');button('pending/').click();await wait(()=>late,'pending directory');
  flushSync(()=>root.render(<HistoricalTree sessionId='other' repositoryId='r' {...{commit,rpc,t}} onRediscover={()=>{}}/>));
  if(!oldSignal.aborted)throw Error('Tree page not cancelled on scope');late({commit,path:'pending',entries:[{path:'STALE',mode:'100644',type:'blob',oid}],nextOffset:null});await new Promise(r=>setTimeout(r,40));if(host.textContent.includes('STALE'))throw Error('Late tree page leaked');
  for(const Component of [FileHistory,PathHistory]){
   const pages=[];const historyRpc=async(e,p)=>{pages.push(p);return {path:'f',commits:Array.from({length:50},(_,i)=>({id:String(p.offset+i).padStart(40,'0'),subject:'row '+(p.offset+i),author:'a',date:'2026-01-01'})),nextOffset:p.offset<300?p.offset+50:null};};
   flushSync(()=>root.render(<Component key={Component.name} sessionId='pages' repositoryId='r' commit={commit} parentIndex={0} id={'d'.repeat(64)} path='f' rpc={historyRpc} t={t} onRediscover={()=>{}}/>));
   button(Component===FileHistory?'fileHistory':'pathHistory').click();await wait(()=>host.querySelectorAll('li').length===50,'history initial');
   for(let n=1;n<=6;n++){button('historyMore').click();await wait(()=>pages.at(-1)?.offset===n*50&&!host.querySelector('section[aria-busy=true]'),'history page '+n);if(host.querySelectorAll('li').length>200)throw Error('File history window exceeded 200');}
   button('historyBack').click();await wait(()=>pages.at(-1)?.offset===250&&host.querySelectorAll('li').length===50,'history previous page');
   if(!host.textContent.includes('row 250'))throw Error('History previous coordinates lost');
  }
 }finally{root.unmount();host.remove();}
}
