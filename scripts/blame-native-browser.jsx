import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import BlamePanel from '../src/BlamePanel.jsx';
export async function mount(){
 const host=document.createElement('div');host.id='native-blame';document.body.appendChild(host);const root=createRoot(host);
 const state={selected:[],trusted:[],calls:0},commit='a'.repeat(40);globalThis.nativeBlameState=state;
 host.addEventListener('click',e=>{if(e.target.closest('tbody button'))state.trusted.push(e.isTrusted);});
 flushSync(()=>root.render(<><BlamePanel sessionId='s' repositoryId='r' commit={commit} parentIndex={0} id='file' t={k=>k} onRediscover={()=>{}} onSelectCommit={oid=>state.selected.push(oid)} rpc={async()=>{state.calls++;return {lines:[{line:1,commit,author:'author',summary:'summary',text:'source'}]};}}/><button id='after-blame'>after</button></>));
 flushSync(()=>host.querySelector('button').click());
 for(let i=0;i<100&&!host.querySelector('tbody button');i++)await new Promise(r=>setTimeout(r,20));
 if(!host.querySelector('tbody button')){root.unmount();host.remove();throw Error('Native blame fixture timeout');}
 host.querySelector('tbody button').focus();
 return ()=>{root.unmount();host.remove();delete globalThis.nativeBlameState;};
}
