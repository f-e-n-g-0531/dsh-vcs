import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import ImageComparison from '../src/ImageComparison.jsx';
export async function mount(){
 const host=document.createElement('div');host.id='native-image';host.style.width='620px';document.body.appendChild(host);const root=createRoot(host);let calls=0;const trusted=[];
 const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
 const rpc=async(_,p)=>{calls++;return {commit:'a'.repeat(40),path:p.side+'.png',mime:'image/png',base64,bytes:atob(base64).length,width:1,height:1};};
 flushSync(()=>root.render(<ImageComparison sessionId='s' repositoryId='r' commit={'a'.repeat(40)} parentIndex={0} id={'b'.repeat(64)} rpc={rpc} t={k=>k} onRediscover={()=>{}}/>));
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Native image fixture timeout');};
 const button=label=>[...host.querySelectorAll('button')].find(b=>b.textContent===label);button('imageCompare').click();await wait(()=>host.querySelectorAll('img').length===2);
 const focus=async mode=>{button(mode==='overlay'?'imageOverlay':'imageSwipe').click();await wait(()=>host.querySelector('input[type=range]'));const range=host.querySelector('input[type=range]');range.addEventListener('input',event=>trusted.push(event.isTrusted));range.focus();return true;};
 await focus('overlay');globalThis.nativeImage={focus,state:()=>({value:host.querySelector('input[type=range]')?.value,calls,trusted:[...trusted],opacity:host.querySelector('[data-image-canvas] img:last-child')?.style.opacity,clip:host.querySelector('[data-image-canvas] img:last-child')?.style.clipPath})};
 return ()=>{flushSync(()=>root.unmount());host.remove();delete globalThis.nativeImage;};
}