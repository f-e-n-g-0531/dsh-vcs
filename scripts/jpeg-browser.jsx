import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import ImageComparison from '../src/ImageComparison.jsx';
import {loadPreviewImage} from '../src/image-resource.mjs';
export async function checkJpegComparison(images){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),calls=[];const urls=new Set(),create=URL.createObjectURL,revoke=URL.revokeObjectURL;
 URL.createObjectURL=b=>{const u=create.call(URL,b);urls.add(u);return u;};URL.revokeObjectURL=u=>{if(!urls.delete(u))throw Error('JPEG UI double release');revoke.call(URL,u);};
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('JPEG comparison timeout');};
 try{flushSync(()=>root.render(<ImageComparison base={'a'.repeat(40)} target={'b'.repeat(40)} sessionId='jpeg' repositoryId='fixture' id={'c'.repeat(64)} t={k=>k} onRediscover={()=>{}} rpc={async(e,p,s)=>{if(e!=='vcs/revision-image')throw Error('JPEG UI endpoint');calls.push(s);return images[p.side==='left'?0:1];}}/>));host.querySelector('button').click();await wait(()=>host.querySelectorAll('img').length===2);if(urls.size!==2||!host.textContent.includes(images[1].path))throw Error('JPEG UI images missing');host.querySelector('button').click();await wait(()=>urls.size===0);if(calls.some(s=>!s.aborted))throw Error('JPEG UI close did not cancel');}
 finally{root.unmount();host.remove();URL.createObjectURL=create;URL.revokeObjectURL=revoke;for(const u of urls)revoke.call(URL,u);}
}
export async function checkLosslessWebp(base64){
 const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0)),resource=await loadPreviewImage(new Blob([bytes],{type:'image/webp'}),{width:3,height:2});
 try{const image=new Image();image.src=resource.url;await image.decode();const canvas=document.createElement('canvas');canvas.width=3;canvas.height=2;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const alpha=ctx.getImageData(0,0,1,1).data[3];if(alpha!==128)throw Error('Lossless alpha changed: '+alpha);}finally{resource.dispose();}
 const invalid=new Uint8Array(26);invalid.set([82,73,70,70,18,0,0,0,87,69,66,80,86,80,56,76,5,0,0,0,47,2,64,0,16,0]);
 let rejected=false;try{const value=await loadPreviewImage(new Blob([invalid],{type:'image/webp'}),{width:3,height:2});value.dispose();}catch{rejected=true;}if(!rejected)throw Error('Header-only lossless image decoded');
}
export async function checkPreparedWebp(base64){
 const blob=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'image/webp'}),urls=new Set();
 const options={width:3,height:2,createURL:b=>{const u=URL.createObjectURL(b);urls.add(u);return u;},revokeURL:u=>{if(!urls.delete(u))throw Error('WebP double release');URL.revokeObjectURL(u);}};
 const image=await loadPreviewImage(blob,options);image.dispose();if(urls.size)throw Error('WebP URL retained');let rejected=false;try{await loadPreviewImage(blob,{...options,width:4});}catch{rejected=true;}if(!rejected||urls.size)throw Error('WebP mismatch accepted or leaked');
 rejected=false;try{await loadPreviewImage(new Blob(['bad'],{type:'image/webp'}),options);}catch{rejected=true;}if(!rejected||urls.size)throw Error('WebP corrupt accepted or leaked');
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
