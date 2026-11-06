import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import TagCreate from '../src/TagCreate.jsx';

// Opt-in, isolated mock RPC scenario only; never writes a repository.
export async function checkTagCreate(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),calls=[];let scope='s',prepared,created=0,unknowns=0,finish;
 const result=()=>({name:prepared.name,ref:prepared.ref,tagOid:prepared.object.oid,commit:prepared.head,currentRef:prepared.currentRef});
 const rpc=async(e,p,signal)=>{calls.push({e,p,signal});if(e==='vcs/tag-create-prepare')return prepared={action:'tag-create',name:p.name,ref:'refs/tags/'+p.name,object:{oid:'d'.repeat(40)},targetTree:'c'.repeat(40),tagger:{...p.tagger},message:p.message,messageBytes:new TextEncoder().encode(p.message).length,planId:'f'.repeat(64),head:'a'.repeat(40),currentRef:'refs/heads/main',objectFormat:'sha1',token:'e'.repeat(64),expiresAt:Date.now()+59000};if(e==='vcs/tag-create-confirm'){if(scope==='pending')return new Promise(done=>finish=done);return result();}throw Error('Unexpected RPC '+e);};
 const render=()=>flushSync(()=>root.render(<TagCreate sessionId={scope} repositoryId="r" mode="all" rpc={rpc} t={k=>k} onCreated={()=>created++} onUnknown={()=>unknowns++}/>));
 const wait=async(fn,label)=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(done=>setTimeout(done,25));}throw Error('Tag create timeout: '+label);};
 const button=label=>[...host.querySelectorAll('button')].find(node=>node.textContent===label);
 const set=(label,value,area=false)=>flushSync(()=>{const node=host.querySelector('[aria-label="'+label+'"]');Object.getOwnPropertyDescriptor(area?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});
 const fill=name=>{set('tagCreateName',name);for(const [key,value]of Object.entries({name:'Explicit',email:'tag@example.test',timestamp:'1700000000',timezone:'+0800'}))set('tagCreateTagger commit'+key,value);set('tagCreateMessage','explicit message',true);};
 const prepare=async()=>{button('tagCreatePrepare').click();await wait(()=>button('tagCreateConfirm'),'preview');};
 try{
  render();if(calls.length||host.querySelector('[aria-label="tagCreateName"]').value)throw Error('Automatic read/default');fill('topic/new');await prepare();if(!button('tagCreateConfirm').disabled||host.textContent.includes(prepared.token))throw Error('Unsafe ack/token');
  if(Object.keys(calls[0].p).sort().join()!=='message,name,repositoryId,sessionId,tagger')throw Error('Unexpected prepare payload');
  for(const text of [prepared.name,prepared.ref,prepared.head,prepared.currentRef,'HEAD','tagCreateWarning'])if(!host.textContent.includes(text))throw Error('Missing fixed field');
  host.querySelector('input[type=checkbox]').click();await wait(()=>!button('tagCreateConfirm').disabled,'ack');fill('topic/edited');if(button('tagCreateConfirm'))throw Error('Edited candidate retained');await prepare();if(!button('tagCreateConfirm').disabled)throw Error('Ack reused');
  host.querySelector('input[type=checkbox]').click();await wait(()=>!button('tagCreateConfirm').disabled,'second ack');const confirm=button('tagCreateConfirm');confirm.click();confirm.click();await wait(()=>created===1,'success');const writes=calls.filter(c=>c.e==='vcs/tag-create-confirm');if(writes.length!==1||Object.keys(writes[0].p).sort().join()!=='repositoryId,sessionId,token')throw Error('Unexpected confirm payload');
  scope='pending';render();fill('topic/pending');await prepare();host.querySelector('input[type=checkbox]').click();await wait(()=>!button('tagCreateConfirm').disabled,'pending ack');button('tagCreateConfirm').click();await wait(()=>finish,'pending request');button('tagCreateCancel').click();await wait(()=>unknowns===1,'unknown');finish(result());await wait(()=>button('tagCreatePrepare').disabled,'unknown blocks retry');if(created!==1)throw Error('Late success accepted');
 }finally{root.unmount();host.remove();}
}
