import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import ReflogPanel from '../src/ReflogPanel.jsx';

export async function checkReflog(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const id='a'.repeat(40),calls=[],snapshot={entries:[{id,selector:'HEAD@{0}',message:'reset: moving to fixed',date:'2026-11-05T10:00:00Z'},{id,selector:'HEAD@{1}',message:'same commit again',date:'2026-11-04T10:00:00Z'}],truncated:true};
 let sessionId='s',repositoryId='r',mode='ready',finish,fail,rediscoveries=0;
 const rpc=async(e,p,signal)=>{
  calls.push({e,p,signal});
  if(e==='vcs/reflog'){
   if(Object.keys(p).sort().join(',')!=='repositoryId,sessionId')throw Error('Reflog payload includes unsupported parameters');
   if(mode==='pending')return new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
   if(mode==='error')throw Error('Reflog test read error');
   if(mode==='expired')throw Object.assign(Error('Reflog expired'),{code:'vcs/rediscover-required'});
   if(mode==='empty')return {entries:[],truncated:false};
   return snapshot;
  }
  if(e==='vcs/commit'){
   if(p.commit!==id)throw Error('Reflog used selector instead of exact returned OID');
   return {id,subject:'Fixed reflog commit details',author:'T',date:'2026-11-05',parents:[],parent:null,changes:[]};
  }
  if(e==='vcs/tree')return {entries:[]};
  throw Error('Unexpected (possibly write) endpoint '+e);
 };
 const render=()=>flushSync(()=>root.render(<ReflogPanel {...{sessionId,repositoryId,rpc}} t={k=>k} onRediscover={()=>{rediscoveries++;}}/>));
 const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Reflog timeout at '+label);};
 const button=label=>[...host.querySelectorAll('button')].find(b=>b.textContent===label);
 const row=()=>[...host.querySelectorAll('button')].find(b=>b.textContent.includes('HEAD@{0}'));
 const settle=()=>new Promise(resolve=>setTimeout(resolve,30));
 try{
  render();await wait(()=>row(),'snapshot');
  if(!host.textContent.includes('reset: moving to fixed')||!host.textContent.includes(snapshot.entries[0].date)||!host.textContent.includes('reflogScope')||!host.textContent.includes('reflogTruncated'))throw Error('Missing snapshot metadata or read-only/limit notice');
  if(host.querySelectorAll('ol li').length!==2)throw Error('Repeated OIDs must retain separate reflog rows');
  if(calls.length!==1)throw Error('Reflog paginated automatically');
  row().click();await wait(()=>host.querySelector('[aria-label="commitDetails"]'),'fixed commit details');
  if(!host.textContent.includes(id))throw Error('Missing fixed commit OID');
  mode='error';button('refresh').click();await wait(()=>host.textContent.includes('Reflog test read error'),'read error');
  if(host.querySelector('[aria-label="commitDetails"]'))throw Error('Refresh retained stale commit details');
  mode='ready';button('retry').click();await wait(()=>row(),'error retry');
  mode='pending';button('refresh').click();await wait(()=>button('reflogCancel')&&finish,'pending cancel');const cancelled=calls.at(-1);
  button('reflogCancel').click();await wait(()=>host.textContent.includes('reflogCancelled'),'cancelled');
  if(!cancelled.signal.aborted)throw Error('Cancel did not abort signal');finish(snapshot);await settle();if(row())throw Error('Cancelled late result was displayed');
  mode='pending';finish=null;button('retry').click();await wait(()=>finish,'pending repository change');const oldRepository=calls.at(-1),oldFinish=finish;
  mode='empty';repositoryId='other';render();await wait(()=>host.textContent.includes('reflogEmpty'),'repository scope');
  if(!oldRepository.signal.aborted)throw Error('Repository change did not cancel old snapshot');oldFinish(snapshot);await settle();if(row())throw Error('Old repository result was displayed');
  mode='pending';button('refresh').click();await wait(()=>button('reflogCancel'),'pending session change');const oldSession=calls.at(-1),oldFail=fail;
  mode='empty';sessionId='next';render();await wait(()=>host.textContent.includes('reflogEmpty'),'session scope');
  if(!oldSession.signal.aborted)throw Error('Session change did not cancel old snapshot');oldFail(Object.assign(Error('old expiry'),{code:'vcs/rediscover-required'}));await settle();if(rediscoveries)throw Error('Stale error triggered rediscovery');
  mode='expired';button('refresh').click();await wait(()=>rediscoveries===1,'expiry rediscovery');
  mode='ready';button('retry').click();await wait(()=>row(),'expiry retry');
  if(calls.some(c=>!['vcs/reflog','vcs/commit','vcs/tree'].includes(c.e)))throw Error('Read-only reflog used a write/reset endpoint');
 }finally{root.unmount();host.remove();}
}
