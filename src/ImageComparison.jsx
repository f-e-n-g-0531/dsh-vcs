import React,{useEffect,useState} from 'react';
import {loadPreviewImage} from './image-resource.mjs';
function ImageSide({side,sessionId,repositoryId,commit,parentIndex,base,target,workspace=false,mode,id,rpc,t,onRediscover}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let resource;setData(null);setError('');
  (async()=>{
   const value=await rpc(workspace?'vcs/workspace-image':base?'vcs/revision-image':'vcs/commit-image',workspace?{sessionId,repositoryId,mode,id,side}:base?{sessionId,repositoryId,base,target,id,side}:{sessionId,repositoryId,commit,parentIndex,id,side},controller.signal);
   if(controller.signal.aborted)return;
   if(value.absent){setData(value);return;}
   if(!['image/png','image/jpeg','image/webp'].includes(value.mime)||typeof value.base64!=='string'||value.base64.length>2796204||!Number.isInteger(value.bytes)||value.bytes<1||value.bytes>2097152)throw Error(t('imageInvalid'));
   const binary=atob(value.base64);if(binary.length!==value.bytes)throw Error(t('imageInvalid'));
   const blob=new Blob([Uint8Array.from(binary,c=>c.charCodeAt(0))],{type:value.mime});
   resource=await loadPreviewImage(blob,{width:value.width,height:value.height,signal:controller.signal});
   if(controller.signal.aborted){resource.dispose();return;}
   setData({...value,url:resource.url});
  })().catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
  return()=>{controller.abort();resource?.dispose();};
 },[side,sessionId,repositoryId,commit,parentIndex,base,target,workspace,mode,id,retry]);
 return <section style={{flex:'1 1 280px',minWidth:0}} aria-label={t(side==='left'?'imageBefore':'imageAfter')}><h5>{t(side==='left'?'imageBefore':'imageAfter')}</h5>
 {error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>:!data?<p role="status">{t('loading')}</p>:<><p><code>{data.commit}</code> · {data.path}</p>{data.absent?<p>{t('imageAbsent')}</p>:<><p>{data.width} × {data.height} · {data.bytes} B</p><img src={data.url} alt={data.path} style={{maxWidth:'100%',maxHeight:480,objectFit:'contain'}}/>{data.metadataStripped&&<p>{t('imageMetadata')}</p>}</>}</>}
 </section>;
}
export default function ImageComparison(props){const [open,setOpen]=useState(false);return <div><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{props.t('imageCompare')}</button>{open&&<><p>{props.t('imageScope')}</p><div style={{display:'flex',flexWrap:'wrap',gap:16}}>{['left','right'].map(side=><ImageSide key={side} {...props} side={side}/>)}</div></>}</div>;}
