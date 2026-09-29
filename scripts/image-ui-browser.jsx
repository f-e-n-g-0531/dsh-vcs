import React from 'react';
import {createRoot} from 'react-dom/client';
import ImageComparison from '../src/ImageComparison.jsx';
export async function checkImageUI(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Image UI timeout');};
 const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',calls=[],active=new Set();let mode='normal',pending=[];
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
 URL.createObjectURL=b=>{const u=create.call(URL,b);active.add(u);return u;};URL.revokeObjectURL=u=>{if(!active.delete(u))throw Error('Image UI double revoke');revoke.call(URL,u);};
 const value=side=>({commit:'a'.repeat(40),path:side+'.png',mime:'image/png',base64,bytes:atob(base64).length,width:1,height:1,metadataStripped:true});
 const rpc=async(endpoint,p,signal)=>{if(endpoint!=='vcs/commit-image'||p.id!=='b'.repeat(64)||p.parentIndex!==1)throw Error('Wrong image request');calls.push({p,signal});if(mode==='pending')return new Promise(resolve=>pending.push(()=>resolve(value(p.side))));if(mode==='mixed'&&p.side==='left')throw Error('unsupported image');return value(p.side);};
 const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
 try{
 root.render(<ImageComparison sessionId="s" repositoryId="r" commit={'a'.repeat(40)} parentIndex={1} id={'b'.repeat(64)} rpc={rpc} t={k=>k} onRediscover={()=>{}}/>);
 await wait(()=>button('imageCompare'));if(calls.length)throw Error('Images fetched before expansion');button('imageCompare').click();await wait(()=>host.querySelectorAll('img').length===2);
 if(active.size!==2||!host.textContent.includes('imageMetadata')||!host.textContent.includes('left.png'))throw Error('Image details missing');
 button('imageCompare').click();await wait(()=>active.size===0&&!host.querySelector('img'));if(calls.some(c=>!c.signal.aborted))throw Error('Image close did not cancel');
 mode='mixed';button('imageCompare').click();await wait(()=>host.querySelector('[role=alert]')&&host.querySelectorAll('img').length===1);mode='normal';button('retry').click();await wait(()=>host.querySelectorAll('img').length===2);button('imageCompare').click();await wait(()=>active.size===0);
 mode='pending';button('imageCompare').click();await wait(()=>pending.length===2);button('imageCompare').click();await wait(()=>calls.slice(-2).every(c=>c.signal.aborted));pending.forEach(done=>done());await new Promise(r=>setTimeout(r,30));if(active.size||host.querySelector('img'))throw Error('Late image response revived closed UI');
 }finally{root.unmount();host.remove();URL.createObjectURL=create;URL.revokeObjectURL=revoke;for(const u of active)revoke.call(URL,u);}
}
