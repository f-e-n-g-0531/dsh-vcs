import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import PartialStage from '../src/PartialStage.jsx';

// Opt-in isolated fixture: no real repository writes.
export async function checkPartialStage(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),calls=[];
 let scope='s',id='opaque',refresh=0,refreshes=0,unknowns=0,prepared,fail=false,late,expiry=59000;
 const unit={id:'1'.repeat(64),beforeStart:0,beforeCount:1,afterStart:0,afterCount:1,before:[{text:'old',terminator:'CRLF'}],after:[{text:'new',terminator:'NONE'}]};
 const planned=()=>({action:'partial-stage',path:'folder/中文.txt',head:'a'.repeat(40),index:{oid:'b'.repeat(40),mode:'100644'},plan:{id:'2'.repeat(64),algorithm:'raw-line-lcs-v1',beforeHash:'3'.repeat(64),afterHash:'4'.repeat(64),beforeBytes:5,afterBytes:3,beforeLineCount:1,afterLineCount:1,lcsCells:4,units:[unit]},planToken:'d'.repeat(64),expiresAt:Date.now()+expiry});
 const rpc=async(e,p,signal)=>{calls.push({e,p,signal});if(e==='vcs/partial-stage-plan'){if(scope==='late')return new Promise(done=>{late=done;});return planned();}if(e==='vcs/partial-stage-prepare'){const v=planned();return prepared={action:v.action,path:v.path,head:v.head,index:v.index,target:{oid:'c'.repeat(40),mode:'100644'},planId:v.plan.id,unitIds:[...p.unitIds],token:'e'.repeat(64),expiresAt:Date.now()+expiry};}if(e==='vcs/partial-stage-confirm'){if(fail)throw Error('lost response');return {path:prepared.path,head:prepared.head,index:prepared.target};}throw Error(e);};
 const render=()=>flushSync(()=>root.render(<PartialStage sessionId={scope} repositoryId="r" id={id} mode="unstaged" refresh={refresh} rpc={rpc} t={k=>k} onStaged={()=>{refreshes++;}} onUnknown={()=>{unknowns++;}}/>));
 const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(done=>setTimeout(done,25));}throw Error('Partial stage timeout: '+label);};
 const button=label=>[...host.querySelectorAll('button')].find(node=>node.textContent===label);
 const checkbox=label=>[...host.querySelectorAll('input')].find(node=>node.getAttribute('aria-label')===label);
 const plan=async()=>{button('partialPlan').click();await wait(()=>button('partialPrepare'),'plan');};
 const prepare=async()=>{checkbox('partialUnit 1').click();await wait(()=>!button('partialPrepare').disabled,'selection');button('partialPrepare').click();await wait(()=>button('partialConfirm'),'candidate');};
 const acknowledge=async()=>{checkbox('partialAcknowledge').click();await wait(()=>!button('partialConfirm').disabled,'consent');};
 try{
  render();if(calls.length)throw Error('Automatic RPC');await plan();if(!button('partialPrepare').disabled)throw Error('Empty selection accepted');
  if(!host.textContent.includes('⟦CRLF⟧')||!host.textContent.includes('⟦NONE⟧')||!host.textContent.includes('−1 (1) / +1 (1)'))throw Error('Raw newline/coordinates missing');
  await prepare();if(!checkbox('partialUnit 1').disabled||!button('partialConfirm').disabled)throw Error('Selection/consent unsafe');if(host.textContent.includes(prepared.token))throw Error('Token displayed');
  button('partialCancel').click();await wait(()=>!button('partialConfirm'),'cancel');if(calls.length!==2)throw Error('Cancel wrote');
  await plan();await prepare();await acknowledge();const final=button('partialConfirm');final.click();final.click();await wait(()=>refreshes===1,'success');
  const phases=['id,repositoryId,sessionId','planToken,repositoryId,sessionId,unitIds','repositoryId,sessionId,token'];for(let i=0;i<3;i++)if(Object.keys(calls[calls.length-3+i].p).sort().join()!==phases[i])throw Error('Unsafe RPC payload');
  // Standalone counterpart to production rediscovery: a fresh opaque ID/refresh must discard the old selection and consent.
  id='fresh-id';refresh++;render();await wait(()=>button('partialPlan')&&!button('partialPrepare')&&!button('partialConfirm'),'fresh scope');
  const beforeSecond=calls.length;await plan();if(calls.at(-1).p.id!=='fresh-id'||checkbox('partialUnit 1').checked)throw Error('Stale ID/selection after rediscovery');
  await prepare();if(checkbox('partialAcknowledge').checked||!button('partialConfirm').disabled)throw Error('Stale consent after rediscovery');await acknowledge();button('partialConfirm').click();await wait(()=>refreshes===2,'successive confirmation');
  if(calls.length!==beforeSecond+3||calls.at(-1).e!=='vcs/partial-stage-confirm')throw Error('Unexpected successive RPC sequence');
  scope='expires';expiry=250;render();await plan();await wait(()=>!button('partialPrepare'),'plan expiry');if(!host.textContent.includes('partialExpired'))throw Error('Expiry missing');expiry=59000;
  scope='unknown';fail=true;render();await plan();await prepare();await acknowledge();button('partialConfirm').click();await wait(()=>unknowns===1,'unknown');if(!button('partialPlan').disabled||refreshes!==2)throw Error('Unknown retried');
  scope='late';render();button('partialPlan').click();await wait(()=>late,'late read');const pending=calls.at(-1);scope='new';render();await wait(()=>pending.signal.aborted,'scope abort');late(planned());await new Promise(done=>setTimeout(done,25));if(button('partialPrepare'))throw Error('Late plan accepted');
  return {ok:true,calls:calls.length,refreshes,unknowns};
 }finally{root.unmount();host.remove();}
}
