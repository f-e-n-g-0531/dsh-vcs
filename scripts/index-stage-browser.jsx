import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import IndexStage from '../src/IndexStage.jsx';

// Standalone opt-in browser check; no real repository writes.
export async function checkIndexStage(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),calls=[];
 let refreshes=0,fail=false,scope='s',late,expiry=59000;
 const prepared=()=>({action:'stage',path:'folder/中文.txt',head:'a'.repeat(40),index:{oid:'b'.repeat(40),mode:'100644'},target:{oid:'c'.repeat(40),mode:'100644'},token:'d'.repeat(64),expiresAt:Date.now()+expiry});
 const rpc=async(e,p,signal)=>{calls.push({e,p,signal});if(e==='vcs/index-stage-prepare'){if(p.sessionId==='late')return new Promise(done=>{late=done;});return prepared();}if(e==='vcs/index-stage-confirm'){if(fail)throw Error('Connection lost after sending');const value=prepared();return {path:value.path,head:value.head,index:value.target};}throw Error('Unexpected endpoint '+e);};
 const render=()=>flushSync(()=>root.render(<IndexStage sessionId={scope} repositoryId="r" id="opaque-id" refresh={0} mode="unstaged" rpc={rpc} t={k=>k} onStaged={()=>{refreshes++;}}/>));
 const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Stage timeout: '+label);};
 const button=label=>[...host.querySelectorAll('button')].find(node=>node.textContent===label);
 const prepare=async()=>{button('stagePrepare').click();await wait(()=>button('stageConfirm'),'preview');};
 const acknowledge=async()=>{host.querySelector('input[type=checkbox]').click();await wait(()=>!button('stageConfirm').disabled,'explicit checkbox');};
 try{
  render();if(calls.length)throw Error('Automatic prepare');await prepare();
  const value=prepared();for(const text of [value.path,value.head,value.index.oid,value.target.oid,value.index.mode])if(!host.textContent.includes(text))throw Error('Missing preview detail');
  if(host.textContent.includes(value.token)||!button('stageConfirm').disabled)throw Error('Unsafe token/checkbox');
  button('stageCancel').click();await wait(()=>!button('stageConfirm'),'cancel');if(calls.length!==1||!calls[0].signal.aborted)throw Error('Cancel did not abort prepare');
  await prepare();await acknowledge();const confirm=button('stageConfirm');confirm.click();confirm.click();await wait(()=>refreshes===1,'success');
  const writes=calls.filter(c=>c.e==='vcs/index-stage-confirm');if(writes.length!==1||Object.keys(writes[0].p).sort().join()!=='repositoryId,sessionId,token')throw Error('Confirmation not token-only/once');
  if(Object.keys(calls[0].p).sort().join()!=='id,repositoryId,sessionId')throw Error('Preparation sends more than identity');
  scope='expiry';expiry=250;render();await prepare();await acknowledge();const beforeExpiry=calls.length;await wait(()=>!button('stageConfirm'),'expiry');if(!host.textContent.includes('stageExpired')||calls.length!==beforeExpiry)throw Error('Expired token sent');expiry=59000;
  scope='unknown';fail=true;render();await prepare();await acknowledge();button('stageConfirm').click();await wait(()=>button('stageRecover'),'unknown');if(refreshes!==1||button('stageConfirm')||!button('stagePrepare').disabled)throw Error('Unknown result retried');button('stageRecover').click();if(refreshes!==2)throw Error('Explicit refresh missing');
  scope='late';render();button('stagePrepare').click();await wait(()=>late,'pending prepare');const pending=calls.at(-1);scope='new';render();await wait(()=>pending.signal.aborted,'scope abort');late(prepared());await new Promise(r=>setTimeout(r,30));if(button('stageConfirm'))throw Error('Stale scope accepted');
 }finally{root.unmount();host.remove();}
}
