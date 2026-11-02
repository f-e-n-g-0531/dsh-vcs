import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import BranchSwitcher from '../src/BranchSwitcher.jsx';
export async function checkBranchSwitch(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const A={name:'main',ref:'refs/heads/main',commit:'a'.repeat(40)},B={name:'feature/中文',ref:'refs/heads/feature/中文',commit:'b'.repeat(40)},calls=[];
 let refreshes=0,failConfirm=false,late,scope='s',token=0;
 const rpc=async(e,p,signal)=>{calls.push({e,p,signal});if(e==='vcs/branches')return {current:A,branches:[A,B]};if(e==='vcs/branch-switch-prepare'){if(p.sessionId==='late')return new Promise(done=>{late=done;});return {token:(++token).toString(16).padStart(64,'0'),expiresAt:Date.now()+59000,current:A,target:B};}if(e==='vcs/branch-switch-confirm'){if(failConfirm)throw Object.assign(Error('Disconnected after write start'),{code:'vcs/branch-outcome-unknown'});return {current:B};}throw Error('Unexpected branch endpoint '+e);};
 const render=()=>flushSync(()=>root.render(<BranchSwitcher sessionId={scope} repositoryId='r' rpc={rpc} t={k=>k} onSwitched={()=>{refreshes++;}} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>));
 const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Branch switch timeout '+label);};
 const button=label=>[...host.querySelectorAll('button')].find(b=>b.textContent===label);
 const prepare=async()=>{button('branchSwitcher').click();await wait(()=>host.querySelector('select'),'branches');const select=host.querySelector('select');select.value=B.name;select.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>!button('branchPrepare').disabled,'selected target');button('branchPrepare').click();await wait(()=>button('branchConfirm'),'confirmation');};
 try{
  render();if(calls.length)throw Error('Branch view queried automatically');await prepare();
  if(!host.textContent.includes(A.commit)||!host.textContent.includes(B.commit))throw Error('Missing current and target full OIDs');
  button('branchCancel').click();await wait(()=>!button('branchConfirm'),'cancel');if(calls.some(c=>c.e==='vcs/branch-switch-confirm'))throw Error('Cancel wrote repository');
  button('branchPrepare').click();await wait(()=>button('branchConfirm'),'prepare again');const confirm=button('branchConfirm');confirm.click();confirm.click();await wait(()=>refreshes===1,'switch');if(calls.filter(c=>c.e==='vcs/branch-switch-confirm').length!==1)throw Error('Duplicate confirmation wrote twice');
  scope='unknown';failConfirm=true;render();await prepare();button('branchConfirm').click();await wait(()=>button('branchRecover'),'unknown outcome');if(refreshes!==1||button('branchRead')||button('branchConfirm'))throw Error('Unknown outcome retried or refreshed automatically');button('branchRecover').click();if(refreshes!==2)throw Error('Explicit unknown recovery did not refresh');
  scope='late';render();button('branchSwitcher').click();await wait(()=>host.querySelector('select'),'late list');const select=host.querySelector('select');select.value=B.name;select.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>!button('branchPrepare').disabled,'late target');button('branchPrepare').click();await wait(()=>late,'pending prepare');const pending=calls.at(-1);scope='new';render();await wait(()=>pending.signal.aborted,'scope cancelled');late({token:'d'.repeat(64),expiresAt:Date.now()+59000,current:A,target:B});await new Promise(r=>setTimeout(r,30));if(button('branchConfirm'))throw Error('Late scope token accepted');
 }finally{root.unmount();host.remove();}
}
