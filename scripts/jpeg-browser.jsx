import {loadPreviewImage} from '../src/image-resource.mjs';
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
