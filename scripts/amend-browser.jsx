import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import AmendPanel from '../src/AmendPanel.jsx';

// Opt-in isolated browser scenario. Mock RPC only: never writes a repository.
export async function checkAmend(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),calls=[];let scope='s',prepared,committed=0,unknowns=0,finish;
 const rpc=async(e,p,signal)=>{calls.push({e,p,signal});if(e==='vcs/amend-prepare')return prepared={action:'amend',head:'a'.repeat(40),ref:'refs/heads/main',objectFormat:'sha1',indexDigest:'b'.repeat(64),previousTree:'9'.repeat(40),parents:[],tree:'c'.repeat(40),commit:{oid:'d'.repeat(40)},author:{name:'Original',email:'original@example.test',timestamp:1600000000,timezone:'+0000'},committer:{...p.committer},message:p.message,token:'e'.repeat(64),expiresAt:Date.now()+59000};if(e==='vcs/amend-confirm'){if(scope==='pending')return new Promise(done=>finish=done);return {head:prepared.commit.oid,ref:prepared.ref,tree:prepared.tree,indexDigest:prepared.indexDigest};}throw Error('Unexpected RPC '+e);};
 const render=()=>flushSync(()=>root.render(<AmendPanel sessionId={scope} repositoryId="r" mode="staged" rpc={rpc} t={k=>k} onAmended={()=>committed++} onUnknown={()=>unknowns++}/>));
 const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(done=>setTimeout(done,25));}throw Error('Commit timeout: '+label);};
 const button=label=>[...host.querySelectorAll('button')].find(node=>node.textContent===label);
 const setValue=(node,value)=>{const prototype=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));};
 const fill=()=>{for(const role of ['commitCommitter'])for(const [key,value] of Object.entries({name:role,email:role+'@example.test',timestamp:'1700000000',timezone:'+0800'}))flushSync(()=>setValue(host.querySelector('[aria-label="'+role+' commit'+key+'"]'),value));flushSync(()=>setValue(host.querySelector('textarea'),'Exact plaintext\n'));};
 const prepare=async()=>{button('amendPrepare').click();await wait(()=>button('amendConfirm'),'preview');};
 try{
  render();if(calls.length||host.querySelector('[aria-label="commitCommitter commitname"]').value)throw Error('Automatic identity lookup/default');fill();await prepare();if(!button('amendConfirm').disabled||host.textContent.includes(prepared.token))throw Error('Unsafe acknowledgement/token');
  if(Object.keys(calls[0].p).sort().join()!=='committer,message,repositoryId,sessionId')throw Error('Unexpected prepare payload');
  for(const text of [prepared.head,prepared.previousTree,prepared.tree,prepared.commit.oid,prepared.ref,prepared.message,'Original','amendRoot','amendOriginalAuthor','amendNewCommit','1700000000','+0800'])if(!host.textContent.includes(text))throw Error('Missing snapshot field');
  // Exercise current DOM controls/native events only; retained React callbacks are covered by the unit harness.
  host.querySelector('input[type=checkbox]').click();await wait(()=>!button('amendConfirm').disabled,'ack');
  const edits=[['textarea','Changed'],['[aria-label="commitCommitter commitname"]','Changed Committer'],['[aria-label="commitCommitter commitemail"]','changed@example.test'],['[aria-label="commitCommitter committimestamp"]','1700000001'],['[aria-label="commitCommitter committimezone"]','+0900']];
  for(const [selector,value] of edits){
   const before=calls.length;flushSync(()=>setValue(host.querySelector(selector),value));
   if(button('amendConfirm')||calls.length!==before)throw Error('Native edit retained candidate or sent RPC: '+selector);
   await prepare();if(!button('amendConfirm').disabled||host.querySelector('input[type=checkbox]').checked)throw Error('Native edit reused acknowledgement: '+selector);
   host.querySelector('input[type=checkbox]').click();await wait(()=>!button('amendConfirm').disabled,'edited ack '+selector);
  }
  const beforeCancel=calls.length,currentMessage=host.querySelector('textarea').value,currentName=host.querySelector('[aria-label="commitCommitter commitname"]').value;
  flushSync(()=>button('amendCancel').click());
  if(button('amendConfirm')||calls.length!==beforeCancel||host.querySelector('textarea').value!==currentMessage||host.querySelector('[aria-label="commitCommitter commitname"]').value!==currentName)throw Error('Current native cancel failed to preserve draft and clear candidate');
  await prepare();if(!button('amendConfirm').disabled||host.querySelector('input[type=checkbox]').checked)throw Error('Cancel reused acknowledgement');
  if(prepared.message!==currentMessage||prepared.committer.name!==currentName)throw Error('Fresh prepare lost native edits');
  host.querySelector('input[type=checkbox]').click();await wait(()=>!button('amendConfirm').disabled,'second ack');const confirm=button('amendConfirm');confirm.click();confirm.click();await wait(()=>committed===1,'success');if(host.querySelector('textarea').value!=='')throw Error('Success did not clear draft');const writes=calls.filter(c=>c.e==='vcs/amend-confirm');if(writes.length!==1||Object.keys(writes[0].p).sort().join()!=='repositoryId,sessionId,token')throw Error('Unexpected confirmation payload');
  scope='pending';render();fill();await prepare();host.querySelector('input[type=checkbox]').click();await wait(()=>!button('amendConfirm').disabled,'pending ack');button('amendConfirm').click();await wait(()=>finish,'pending request');button('amendCancel').click();await wait(()=>unknowns===1,'unknown');finish({head:prepared.commit.oid,ref:prepared.ref,tree:prepared.tree,indexDigest:prepared.indexDigest});await wait(()=>button('amendPrepare').disabled,'unknown blocks retry');if(committed!==1)throw Error('Cancelled request published late success');
 }finally{root.unmount();host.remove();}
}
