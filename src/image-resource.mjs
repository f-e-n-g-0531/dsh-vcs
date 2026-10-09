// Own exactly one local object URL. No remote URLs or HTML content are accepted.
export function loadPreviewImage(blob,{width,height,signal,timeoutMs=10000,createURL=b=>URL.createObjectURL(b),revokeURL=u=>URL.revokeObjectURL(u),createImage=()=>new Image()}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return;}
  if(!['image/png','image/jpeg'].includes(blob?.type)||blob.size>2*1024*1024||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192||width*height>16000000||!Number.isFinite(timeoutMs)||timeoutMs<=0){reject(new Error('Invalid image preview'));return;}
  let url,image,timer,settled=false,released=false;
  const release=()=>{if(released)return;released=true;if(image)image.src='';if(url)revokeURL(url);};
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const fail=error=>{if(settled)return;settled=true;cleanup();release();reject(error);};
  const abort=()=>fail(signal.reason||new Error('Image cancelled'));
  try{
   url=createURL(blob);image=createImage();signal?.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>fail(new Error('Image decode timed out')),timeoutMs);
   image.src=url;
   Promise.resolve(image.decode()).then(()=>{
    if(settled)return;
    if(signal?.aborted){abort();return;}
    if(image.naturalWidth!==width||image.naturalHeight!==height){fail(new Error('Image dimensions mismatch'));return;}
    settled=true;cleanup();resolve({url,dispose:release});
   },fail);
  }catch(error){fail(error);}
 });
}
