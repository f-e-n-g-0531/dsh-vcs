import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import BranchDeletePreview from '../src/BranchDeletePreview.jsx';

// Opt-in isolated fixture: mocked read-only RPC only, never a repository operation.
export async function checkBranchDeletePreview(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),calls=[];let scope='s',finish,pending=false,large=false;
 const candidate=p=>({action:'branch-delete',name:p.name,ref:'refs/heads/'+p.name,objectFormat:'sha1',current:{ref:'refs/heads/main',oid:'a'.repeat(40)},target:{ref:'refs/heads/'+p.name,oid:'b'.repeat(40)},merged:true,proof:['a'.repeat(40),'b'.repeat(40)],planId:'e'.repeat(64)});
 const response=p=>{const v=candidate(p);if(large){v.proof=Array.from({length:10000},(_,i)=>(i+1).toString(16).padStart(40,'0'));v.current.oid=v.proof[0];v.target.oid=v.proof.at(-1);}return v;};
 const rpc=async(e,p,signal)=>{if(e!=='vcs/branch-delete-preview')throw Error('Unexpected RPC '+e);calls.push({e,p,signal});return pending?new Promise(done=>finish=()=>done(response(p))):response(p);};
 const render=()=>flushSync(()=>root.render(<BranchDeletePreview sessionId={scope} repositoryId="r" mode="all" rpc={rpc} t={k=>k}/>));
 const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(done=>setTimeout(done,25));}throw Error('Assessment timeout: '+label);};
 const button=label=>[...host.querySelectorAll('button')].find(node=>node.textContent===label);
 const fill=name=>flushSync(()=>{const node=host.querySelector('[aria-label="branchDeletePreviewName"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,name);node.dispatchEvent(new Event('input',{bubbles:true}));});
 const result=()=>host.querySelector('[aria-label="branchDeletePreviewResult"]');
 try{
  render();if(calls.length)throw Error('Automatic assessment');fill('topic/old');button('branchDeletePreviewAssess').click();await wait(result,'result');
  if(Object.keys(calls[0].p).sort().join()!=='name,repositoryId,sessionId')throw Error('Unexpected payload');
  for(const text of ['topic/old','refs/heads/main','a'.repeat(40),'b'.repeat(40),'branchDeletePreviewWarning'])if(!host.textContent.includes(text))throw Error('Missing assessment fact');
  if(host.querySelector('input[type=checkbox]')||host.querySelectorAll('button').length!==2||!host.querySelector('details'))throw Error('Unexpected permission UI');
  if(host.querySelectorAll('li').length)throw Error('Closed proof mounted OIDs');
  const toggle=async open=>{const details=host.querySelector('details');if(details.open!==open)details.querySelector('summary').click();await wait(()=>details.open===open&&host.querySelectorAll('li').length===(open?(large?100:2):0),'native details toggle');};
  await toggle(true);if(host.querySelectorAll('li').length!==2)throw Error('Small proof missing');await toggle(false);
  large=true;flushSync(()=>button('branchDeletePreviewAssess').click());await wait(result,'10000 result');
  const readCount=calls.length;if(host.querySelectorAll('li').length)throw Error('New proof did not reset closed');
  await toggle(true);
  const rows=()=>[...host.querySelectorAll('li')],list=()=>host.querySelector('ol');
  if(rows().length!==100||list().start!==1||rows()[0].textContent!=='1'.padStart(40,'0')||!button('branchDeletePreviewPrevious').disabled||button('branchDeletePreviewNext').disabled)throw Error('First proof page bounds');
  for(let page=1;page<100;page++){flushSync(()=>button('branchDeletePreviewNext').click());if(rows().length!==100||list().start!==page*100+1)throw Error('Proof page exceeded bounds');}
  if(rows().at(-1).textContent!==(10000).toString(16).padStart(40,'0')||!button('branchDeletePreviewNext').disabled||button('branchDeletePreviewPrevious').disabled||!result().textContent.includes('branchDeletePreviewPage: 100 / 100')||!result().textContent.includes('branchDeletePreviewTotal: 10000'))throw Error('Last proof page bounds');
  flushSync(()=>button('branchDeletePreviewNext').click());if(list().start!==9901)throw Error('Disabled next advanced');
  flushSync(()=>button('branchDeletePreviewPrevious').click());if(list().start!==9801)throw Error('Previous proof page');
  await toggle(false);if(rows().length)throw Error('Closing retained proof OIDs');await toggle(true);
  if(calls.length!==readCount)throw Error('Paging or toggling issued RPC');
  const oldNext=button('branchDeletePreviewNext');flushSync(()=>button('branchDeletePreviewAssess').click());await wait(result,'replacement result');
  oldNext.click();if(rows().length)throw Error('Replacement or stale handler retained open proof');await toggle(true);
  if(list().start!==1||rows().length!==100)throw Error('Replacement did not reset page');oldNext.click();if(list().start!==1||calls.length!==readCount+1)throw Error('Detached pager changed replacement or issued RPC');
  fill('topic/changed');if(result())throw Error('Edit retained result');pending=true;button('branchDeletePreviewAssess').click();await wait(()=>finish,'pending');button('branchDeletePreviewCancel').click();if(!calls.at(-1).signal.aborted)throw Error('Cancel did not abort');finish();await new Promise(done=>setTimeout(done,0));if(result())throw Error('Late result retained');
  finish=null;button('branchDeletePreviewAssess').click();await wait(()=>finish,'second pending');scope='next';render();if(!calls.at(-1).signal.aborted)throw Error('Scope did not abort');finish();await new Promise(done=>setTimeout(done,0));if(result())throw Error('Scope retained late result');
 }finally{root.unmount();host.remove();}
}
