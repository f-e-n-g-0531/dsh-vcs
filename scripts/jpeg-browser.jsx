import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import ImageComparison from '../src/ImageComparison.jsx';
import {loadPreviewImage} from '../src/image-resource.mjs';
export async function checkJpegComparison(images){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),calls=[];const urls=new Set(),create=URL.createObjectURL,revoke=URL.revokeObjectURL;
 URL.createObjectURL=b=>{const u=create.call(URL,b);urls.add(u);return u;};URL.revokeObjectURL=u=>{if(!urls.delete(u))throw Error('JPEG UI double release');revoke.call(URL,u);};
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('JPEG comparison timeout');};
 try{flushSync(()=>root.render(<ImageComparison base={'a'.repeat(40)} target={'b'.repeat(40)} sessionId='jpeg' repositoryId='fixture' id={'c'.repeat(64)} t={k=>k} onRediscover={()=>{}} rpc={async(e,p,s)=>{if(e!=='vcs/revision-image')throw Error('JPEG UI endpoint');calls.push(s);return images[p.side==='left'?0:1];}}/>));host.querySelector('button').click();await wait(()=>host.querySelectorAll('img').length===2);if(urls.size!==2||!host.textContent.includes('renamed.jpg'))throw Error('JPEG UI images missing');host.querySelector('button').click();await wait(()=>urls.size===0);if(calls.some(s=>!s.aborted))throw Error('JPEG UI close did not cancel');}
 finally{root.unmount();host.remove();URL.createObjectURL=create;URL.revokeObjectURL=revoke;for(const u of urls)revoke.call(URL,u);}
}
export async function checkPreparedJpeg(base64){
 const blob=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'image/jpeg'});const image=await loadPreviewImage(blob,{width:3,height:2});image.dispose();
}
export async function checkJpegDecode(){
 const canvas=document.createElement('canvas');canvas.width=3;canvas.height=2;const ctx=canvas.getContext('2d');ctx.fillStyle='#ef5812';ctx.fillRect(0,0,3,2);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.8));if(blob?.type!=='image/jpeg')throw Error('JPEG encoding unavailable');
 const active=new Set(),createURL=b=>{const url=URL.createObjectURL(b);active.add(url);return url;},revokeURL=u=>{if(!active.delete(u))throw Error('JPEG double release');URL.revokeObjectURL(u);};
 const options={width:3,height:2,createURL,revokeURL};const image=await loadPreviewImage(blob,options);if(active.size!==1)throw Error('JPEG URL ownership');image.dispose();image.dispose();if(active.size)throw Error('JPEG resource retained');
 let mismatch=false;try{await loadPreviewImage(blob,{...options,width:4});}catch{mismatch=true;}if(!mismatch||active.size)throw Error('JPEG dimensions mismatch leaked');
 let corrupt=false;try{await loadPreviewImage(new Blob(['invalid'],{type:'image/jpeg'}),options);}catch{corrupt=true;}if(!corrupt||active.size)throw Error('Malformed JPEG accepted or retained');
 const controller=new AbortController();controller.abort();try{await loadPreviewImage(blob,{...options,signal:controller.signal});throw Error('Cancelled JPEG accepted');}catch(e){if(e.message==='Cancelled JPEG accepted')throw e;}if(active.size)throw Error('Cancelled JPEG URL retained');
}
