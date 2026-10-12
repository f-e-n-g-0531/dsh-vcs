import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import HistoryPanel from '../src/HistoryPanel.jsx';
export async function checkHistoryBackNavigation(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const wait=async(fn,label)=>{for(let i=0;i<600;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('History back navigation timeout at '+label);};
 const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),changeId='d'.repeat(64);
 const commit=id=>({id,subject:id===A?'commit A':id===B?'commit B':'commit C',author:'Author',date:'2026-01-01T00:00:00Z',parents:[],parent:null,message:'m',changes:[{id:changeId,path:'file.txt',status:'modified'}]});
 const rpc=async(e,p,signal)=>{
  if(e==='vcs/references')return {references:[]};
  if(e==='vcs/history')return {snapshot:null,nextOffset:null,commits:[{id:A,parents:[],subject:'commit A',author:'Author',date:'2026-01-01T00:00:00Z'}]};
  if(e==='vcs/commit')return commit(p.commit);
  if(e==='vcs/commit-compare')return {path:'file.txt',left:{label:'Parent'},right:{label:'Commit'},binary:true};
  if(e==='vcs/file-history'){const row=p.commit===A?{id:B,subject:'history B'}:{id:C,subject:'history C'};return {path:'file.txt',followsRenames:false,nextOffset:null,commits:[{...row,author:'h',date:'2026-01-01T00:00:00Z',path:'file.txt'}]};}
  throw Error('Unexpected back-navigation endpoint '+e);
 };
 const t=k=>k,buttons=()=>[...host.querySelectorAll('button')],byText=s=>buttons().find(b=>b.textContent.includes(s));
 const h3=()=>host.querySelector('[aria-label="commitDetails"] h3')?.textContent;
 try{
  flushSync(()=>root.render(<HistoryPanel sessionId='s' repositoryId='r' rpc={rpc} t={t} onRediscover={()=>{}}/>));
  await wait(()=>byText('commit A'),'history-load');
  if(byText('historyNavigationBack'))throw Error('Back shown before any deep navigation');
  byText('commit A').click();await wait(()=>byText('file.txt'),'commit-files');
  byText('file.txt').click();await wait(()=>byText('fileHistory'),'file-history-toggle');
  byText('fileHistory').click();await wait(()=>byText('history B'),'file-history-A');
  byText('history B').click();await wait(()=>byText('historyNavigationBack'),'back-after-first-jump');
  await wait(()=>byText('fileHistory'),'file-history-toggle-B');byText('fileHistory').click();await wait(()=>byText('history C'),'file-history-B');
  byText('history C').click();await wait(()=>byText('historyNavigationBack').textContent.includes(B.slice(0,10)),'back-target-B');
  byText('historyNavigationBack').click();await wait(()=>h3()==='commit B','back-to-B');
  if(!byText('historyNavigationBack'))throw Error('Back control vanished with entries remaining');
  byText('historyNavigationBack').click();await wait(()=>h3()==='commit A','back-to-A');
  if(byText('historyNavigationBack'))throw Error('Back control remained after popping the last entry');
 }finally{root.unmount();host.remove();}
}
