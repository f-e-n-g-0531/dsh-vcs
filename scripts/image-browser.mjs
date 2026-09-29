import {loadPreviewImage} from '../src/image-resource.mjs';
export async function checkImage(){
 const canvas=document.createElement('canvas');canvas.width=2;canvas.height=3;canvas.getContext('2d').fillRect(0,0,2,3);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),active=new Set();let created=0,revoked=0;
 const options={width:2,height:3,createURL:b=>{const url=URL.createObjectURL(b);active.add(url);created++;return url;},revokeURL:url=>{if(!active.delete(url))throw Error('Duplicate image URL release');revoked++;URL.revokeObjectURL(url);}};
 try{
 const resource=await loadPreviewImage(blob,options);if(!active.has(resource.url))throw Error('Decoded image released too early');resource.dispose();resource.dispose();
 for(const [data,extra] of [[blob,{width:1}],[new Blob(['invalid'],{type:'image/png'}),{}]]){
  let rejected=false;try{const unexpected=await loadPreviewImage(data,{...options,...extra});unexpected.dispose();}catch{rejected=true;}if(!rejected)throw Error('Invalid image was accepted');
 }
 const controller=new AbortController();controller.abort();let cancelled=false;try{await loadPreviewImage(blob,{...options,signal:controller.signal});}catch{cancelled=true;}if(!cancelled)throw Error('Pre-cancelled image was accepted');
 if(active.size||created!==3||revoked!==3)throw Error('Image object URL leaked');
 }finally{for(const url of active)URL.revokeObjectURL(url);}
}
