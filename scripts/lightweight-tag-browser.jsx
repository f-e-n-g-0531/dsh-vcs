import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import LightweightTagCreate from '../src/LightweightTagCreate.jsx';

// Opt-in, isolated mock RPC scenario only; never writes a repository.
export async function checkLightweightTagCreate(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),calls=[];let scope='s',prepared,created=0,unknowns=0,finish,readFinish,delayPrepare=false;
 const result=()=>({name:prepared.name,ref:prepared.ref,commit:prepared.head,currentRef:prepared.currentRef});
 const rpc=async(e,p,signal)=>{calls.push({e,p,signal});if(e==='vcs/lightweight-tag-prepare'){const value={action:'lightweight-tag-create',name:p.name,ref:'refs/tags/'+p.name,targetTree:'b'.repeat(40),planId:'c'.repeat(64),head:'a'.repeat(40),currentRef:'refs/heads/main',objectFormat:'sha1',token:'e'.repeat(64),expiresAt:Date.now()+59000};if(delayPrepare)return new Promise(done=>readFinish=()=>done(value));return prepared=value;}if(e==='vcs/lightweight-tag-confirm'){if(scope==='pending')return new Promise(done=>finish=done);return result();}throw Error('Unexpected RPC '+e);};
 const render=()=>flushSync(()=>root.render(<LightweightTagCreate sessionId={scope} repositoryId="r" mode="all" rpc={rpc} t={k=>k} onCreated={()=>created++} onUnknown={()=>unknowns++}/>));
 const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(done=>setTimeout(done,25));}throw Error('Lightweight tag create timeout: '+label);};
 const button=label=>[...host.querySelectorAll('button')].find(node=>node.textContent===label);
 const fill=name=>flushSync(()=>{const node=host.querySelector('[aria-label="lightweightTagName"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,name);node.dispatchEvent(new Event('input',{bubbles:true}));});
 const prepare=async()=>{button('lightweightTagPrepare').click();await wait(()=>button('lightweightTagConfirm'),'preview');};
 try{
  render();if(calls.length||host.querySelector('[aria-label="lightweightTagName"]').value)throw Error('Automatic read/default');fill('topic/new');await prepare();if(!button('lightweightTagConfirm').disabled||host.textContent.includes(prepared.token))throw Error('Unsafe ack/token');
  if(Object.keys(calls[0].p).sort().join()!=='name,repositoryId,sessionId')throw Error('Unexpected prepare payload');
  for(const text of [prepared.name,prepared.ref,prepared.head,prepared.currentRef,'HEAD','lightweightTagWarning'])if(!host.textContent.includes(text))throw Error('Missing fixed field');
  host.querySelector('input[type=checkbox]').click();await wait(()=>!button('lightweightTagConfirm').disabled,'ack');fill('topic/edited');if(button('lightweightTagConfirm'))throw Error('Edited candidate retained');await prepare();if(!button('lightweightTagConfirm').disabled)throw Error('Ack reused');
  host.querySelector('input[type=checkbox]').click();await wait(()=>!button('lightweightTagConfirm').disabled,'second ack');const confirm=button('lightweightTagConfirm');confirm.click();confirm.click();await wait(()=>created===1,'success');const writes=calls.filter(c=>c.e==='vcs/lightweight-tag-confirm');if(writes.length!==1||Object.keys(writes[0].p).sort().join()!=='repositoryId,sessionId,token')throw Error('Unexpected confirm payload');
  // Use currently mounted controls: detached React buttons do not exercise saved closures.
  fill('topic/A');await prepare();host.querySelector('input[type=checkbox]').click();await wait(()=>!button('lightweightTagConfirm').disabled,'fresh A ack');
  fill('topic/B');fill('topic/A');if(button('lightweightTagConfirm'))throw Error('Returned draft reused preview');await prepare();if(!button('lightweightTagConfirm').disabled||prepared.name!=='topic/A')throw Error('Returned draft freshness');
  button('lightweightTagCancel').click();await wait(()=>!button('lightweightTagConfirm'),'current cancel');if(unknowns)throw Error('Read-only cancel marked unknown');
  await prepare();if(!button('lightweightTagConfirm').disabled)throw Error('Cancel retained ack');
  delayPrepare=true;fill('topic/late');button('lightweightTagPrepare').click();await wait(()=>readFinish,'delayed read');const finishEditedRead=readFinish;fill('topic/current');delayPrepare=false;await prepare();finishEditedRead();await new Promise(done=>setTimeout(done,0));if(prepared.name!=='topic/current'||!host.textContent.includes('refs/tags/topic/current')||host.textContent.includes('refs/tags/topic/late'))throw Error('Late edited read replaced current preview');
  button('lightweightTagCancel').click();await wait(()=>!button('lightweightTagConfirm'),'cancel current preview');delayPrepare=true;readFinish=null;button('lightweightTagPrepare').click();await wait(()=>readFinish,'cancel read');button('lightweightTagCancel').click();await wait(()=>host.querySelector('[aria-label="lightweightTagTitle"]').getAttribute('aria-busy')==='false','read canceled');readFinish();await new Promise(done=>setTimeout(done,0));if(button('lightweightTagConfirm')||unknowns)throw Error('Canceled read installed preview or marked unknown');delayPrepare=false;await prepare();if(!button('lightweightTagConfirm').disabled)throw Error('Post-cancel prepare missing fresh ack');
  scope='pending';render();fill('topic/pending');await prepare();host.querySelector('input[type=checkbox]').click();await wait(()=>!button('lightweightTagConfirm').disabled,'pending ack');button('lightweightTagConfirm').click();await wait(()=>finish,'pending request');button('lightweightTagCancel').click();await wait(()=>unknowns===1,'unknown');finish(result());await wait(()=>button('lightweightTagPrepare').disabled,'unknown blocks retry');if(created!==1)throw Error('Late success accepted');
 }finally{root.unmount();host.remove();}
}
