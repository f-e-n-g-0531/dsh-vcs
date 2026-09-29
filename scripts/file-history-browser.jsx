import React from 'react';
import {createRoot} from 'react-dom/client';
import FileHistory from '../src/FileHistory.jsx';
export async function checkFileHistory(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const commit='a'.repeat(40),id='b'.repeat(64);let calls=0,delayed,signal;
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('File history UI timeout');};
 const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
 const row=(id,subject)=>({id,subject,author:'Author',date:'2026-09-29T00:00:00Z'});
 const rpc=async(endpoint,p,s)=>{
  calls++;if(endpoint!=='vcs/file-history'||p.commit!==commit||p.id!==id||p.limit!==50)throw Error('Invalid file history request');
  if(calls===3){signal=s;return new Promise(resolve=>delayed=resolve);}
  if(p.offset===0)return {path:'file.txt',commits:[row(commit,'first page')],nextOffset:50};
  if(p.offset!==50)throw Error('Invalid file history offset');
  return {path:'file.txt',commits:[row('c'.repeat(40),'second page')],nextOffset:null};
 };
 try{
 root.render(<FileHistory {...{commit,id,rpc}} parentIndex={0} sessionId="s" repositoryId="r" t={key=>key} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>);
 await wait(()=>button('fileHistory'));if(calls)throw Error('History queried before opt-in');
 button('fileHistory').click();await wait(()=>button('historyMore'));
 if(!host.textContent.includes('fileHistoryScope'))throw Error('Missing path semantics');
 button('historyMore').click();await wait(()=>host.textContent.includes('second page'));
 if(!host.textContent.includes('first page')||button('historyMore'))throw Error('Pagination lost rows or retained next button');
 button('fileHistory').click();await wait(()=>!host.querySelector('section'));
 button('fileHistory').click();await wait(()=>delayed);button('fileHistory').click();await wait(()=>signal.aborted);
 delayed({path:'file.txt',commits:[row(commit,'STALE')],nextOffset:null});await new Promise(r=>setTimeout(r,50));
 if(host.textContent.includes('STALE')||calls!==3)throw Error('Closed history accepted stale response');
 }finally{root.unmount();host.remove();}
}
