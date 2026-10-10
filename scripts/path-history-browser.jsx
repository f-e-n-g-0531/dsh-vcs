import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import PathHistory from '../src/PathHistory.jsx';
import locales from '../src/locales.json';
export async function checkPathHistory(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),commit='a'.repeat(40),file='dir/中文.txt';
 const wait=async(fn,label)=>{for(let i=0;i<600;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Path history timeout at '+label);};
 const row=(id,subject,extra={})=>({id,subject,author:'Author',date:'2026-09-30T00:00:00Z',path:file,...extra});
 try{for(const lang of ['zh','en']){
  const t=k=>locales[lang][k],calls=[],selected=[];let mode='normal',pending=[];
  const rpc=(endpoint,p,signal)=>{if(endpoint!=='vcs/tree-history')throw Error('Unexpected path history endpoint');calls.push({p,signal});
   if(mode==='pending'){const marker='pending-'+calls.length;return new Promise(resolve=>pending.push(()=>resolve(page(p,marker))));}
   if(mode==='error')return Promise.reject(Error('PATH HISTORY FAILURE'));
   if(mode==='expired')return Promise.reject(Object.assign(Error('expired'),{code:'vcs/rediscover-required'}));
   return Promise.resolve(page(p));};
  const page=(p,marker='')=>p.offset?{path:file,commits:[row('b'.repeat(40),'older commit')],nextOffset:null,followsRenames:p.follow}:(p.follow?{path:file,commits:[row('c'.repeat(40),marker+'edited',{boundary:'ambiguous-rename',similarity:80,oldPath:'旧.txt'}),row('d'.repeat(40),'renamed')],nextOffset:100,followsRenames:true}:{path:file,commits:[row('c'.repeat(40),marker+'edited')],nextOffset:50,followsRenames:false});
  const render=key=>flushSync(()=>root.render(<PathHistory key={key} sessionId='s' repositoryId='r' commit={commit} path={file} rpc={rpc} t={t} onSelectCommit={(id,path)=>selected.push([id,path])} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>));
  render(lang);if(calls.length)throw Error('Path history loaded before opt-in');
  const open=[...host.querySelectorAll('button')].find(b=>b.textContent===t('pathHistory'));if(!open)throw Error('Path history opt-in button missing');
  open.click();await wait(()=>host.textContent.includes('edited'),'initial-load');
  if(calls[0].p.sessionId!=='s'||calls[0].p.repositoryId!=='r'||calls[0].p.commit!==commit||calls[0].p.path!==file||calls[0].p.offset!==0||calls[0].p.limit!==50||calls[0].p.follow!==false||!calls[0].signal)throw Error('Wrong path history request fields');
  if(!host.textContent.includes(t('pathHistoryScope'))||!host.textContent.includes(t('pathHistoryNoFollow')))throw Error('Path history scope not disclosed');
  [...host.querySelectorAll('li button')].find(b=>b.textContent==='edited').click();if(JSON.stringify(selected)!==JSON.stringify([['c'.repeat(40),file]]))throw Error('Path history navigation lost its exact path');
  const more=[...host.querySelectorAll('button')].find(b=>b.textContent===t('historyMore'));more.click();await wait(()=>calls.length===2&&calls[1].p.offset===50,'pagination');if(!host.textContent.includes('older commit'))throw Error('Path history pagination did not append');
  const follow=host.querySelector('input[type=checkbox]');follow.click();await wait(()=>calls.length===3&&calls[2].p.follow===true,'follow-toggle');
  await wait(()=>host.textContent.includes(t('fileHistoryAmbiguous'))&&host.textContent.includes('旧.txt → '+file),'follow-render');
  if(!host.textContent.includes(t('pathHistoryFollowScope')))throw Error('Follow scope not disclosed');
  mode='error';render(lang+'-error');await wait(()=>host.querySelector('[role=alert]'),'error-alert');
  const before=calls.length,retry=[...host.querySelectorAll('button')].find(b=>b.textContent===t('retry'));if(!retry)throw Error('Path history retry button missing');retry.click();await wait(()=>calls.length===before+1,'retry-refetch');
  await wait(()=>host.textContent.includes('edited'),'error-recovery');
  mode='pending';render(lang+'-pending');await wait(()=>pending.length===1,'pending-request');const staleMarker='pending-'+calls.length,old=calls.at(-1);render(lang+'-next');await wait(()=>old.signal.aborted,'cancel-on-switch');const freshMarker='pending-'+calls.length;pending.forEach(done=>done());await new Promise(r=>setTimeout(r,30));await wait(()=>host.textContent.includes(freshMarker),'fresh-response');
  if(host.textContent.includes(staleMarker))throw Error('Stale path history response replaced the new selection');
 }}finally{root.unmount();host.remove();}
}
