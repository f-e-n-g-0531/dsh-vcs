import React,{useEffect,useMemo,useState} from 'react';
import {loadPreviewImage} from './image-resource.mjs';
import {IMAGE_ZOOM_PERCENTAGES,imageScaleStyle} from './image-view.mjs';
// Owners stay mounted in every presentation mode. Only identity/retry changes load resources.
function ImageSide({side,sessionId,repositoryId,commit,parentIndex,base,target,workspace=false,mode,id,rpc,t,onRediscover,scale='fit',hidden,onData,scope,dimensions}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();let resource;setData(null);setError('');onData(side,scope,null);
  const publish=value=>{setData(value);onData(side,scope,value);};
  (async()=>{
   const value=await rpc(workspace?'vcs/workspace-image':base?'vcs/revision-image':'vcs/commit-image',workspace?{sessionId,repositoryId,mode,id,side}:base?{sessionId,repositoryId,base,target,id,side}:{sessionId,repositoryId,commit,parentIndex,id,side},controller.signal);
   if(controller.signal.aborted)return;
   if(value.absent){publish(value);return;}
   if(!['image/png','image/jpeg','image/webp'].includes(value.mime)||typeof value.base64!=='string'||value.base64.length>2796204||!Number.isInteger(value.bytes)||value.bytes<1||value.bytes>2097152)throw Error(t('imageInvalid'));
   const binary=atob(value.base64);if(binary.length!==value.bytes)throw Error(t('imageInvalid'));
   const blob=new Blob([Uint8Array.from(binary,c=>c.charCodeAt(0))],{type:value.mime});
   resource=await loadPreviewImage(blob,{width:value.width,height:value.height,signal:controller.signal});
   if(controller.signal.aborted){resource.dispose();return;}
   publish({...value,url:resource.url});
  })().catch(e=>{if(controller.signal.aborted)return;setError(e.message);onData(side,scope,null);if(e.code==='vcs/rediscover-required')onRediscover();});
  return()=>{controller.abort();resource?.dispose();};
 },[side,sessionId,repositoryId,commit,parentIndex,base,target,workspace,mode,id,retry,onData,scope]);
 let style=data&&!data.absent?imageScaleStyle(data.width,data.height,scale):null;
 // Shared fit bounds use the maximum canvas, never equalize natural dimensions.
 if(style&&scale==='fit'&&dimensions)style={...style,maxWidth:(data.width/dimensions.width*100)+'%',maxHeight:480*data.height/dimensions.height};
 return <section style={{flex:'1 1 280px',minWidth:0}} aria-label={t(side==='left'?'imageBefore':'imageAfter')}><h5>{t(side==='left'?'imageBefore':'imageAfter')}</h5>
 {error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>:!data?<p role="status">{t('loading')}</p>:<><p><code>{data.commit}</code> · {data.path}</p>{data.absent?<p>{t('imageAbsent')}</p>:<><p>{data.mime}{data.encoding?' · '+data.encoding:''} · {data.width} × {data.height} · {data.bytes} B</p><div role="region" aria-label={t(side==='left'?'imageBefore':'imageAfter')+' · '+t('imageViewport')} tabIndex={0} style={{display:hidden?'none':undefined,maxWidth:'100%',maxHeight:480,overflow:'auto'}}><img src={data.url} alt={data.path} style={style}/></div>{data.metadataStripped&&<p>{t('imageMetadata')}</p>}</>}</>}
 </section>;
}
function boundedPercent(value,set){
 if(typeof value!=='string'||!value.trim())return;
 const number=Number(value);if(Number.isFinite(number))set(Math.min(100,Math.max(0,number)));
}
export default function ImageComparison(props){
 const [open,setOpen]=useState(false),[scale,setScale]=useState('fit'),[presentation,setPresentation]=useState('side-by-side'),[opacity,setOpacity]=useState(50),[split,setSplit]=useState(50),[sides,setSides]=useState({});
 const scope=JSON.stringify([props.sessionId,props.repositoryId,props.commit,props.parentIndex,props.base,props.target,!!props.workspace,props.mode,props.id]);
 const onData=useMemo(()=>(side,identity,data)=>setSides(old=>({...old,[side]:{scope:identity,data}})),[]);
 useEffect(()=>{setScale('fit');setPresentation('side-by-side');setOpacity(50);setSplit(50);},[scope]);
 const left=sides.left?.scope===scope?sides.left.data:null,right=sides.right?.scope===scope?sides.right.data:null;
 const usable=!!(left?.url&&right?.url&&!left.absent&&!right.absent);
 const dimensions=usable?{width:Math.max(left.width,right.width),height:Math.max(left.height,right.height)}:null;
 const composite=presentation!=='side-by-side';
 const canvas=dimensions&&(scale==='fit'?{width:`min(100%, ${dimensions.width}px, ${480*dimensions.width/dimensions.height}px)`,aspectRatio:dimensions.width+'/'+dimensions.height}:{width:dimensions.width*scale/100,height:dimensions.height*scale/100});
 return <div><button aria-expanded={open} onClick={()=>{setOpen(v=>!v);setSides({});}}>{props.t('imageCompare')}</button>{open&&<><p>{props.t('imageScope')}</p>
 <div role="group" aria-label={props.t('imageScale')} style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center'}}>
  <button aria-pressed={scale==='fit'} onClick={()=>setScale('fit')}>{props.t('imageFit')}</button>
  <button aria-pressed={scale===100} onClick={()=>setScale(100)}>{props.t('imageActualSize')}</button>
  <label>{props.t('imageZoom')} <select value={scale} onChange={event=>{const value=event.target.value;if(value==='fit')setScale('fit');else if(IMAGE_ZOOM_PERCENTAGES.includes(Number(value))&&typeof value==='string')setScale(Number(value));}}><option value="fit">{props.t('imageFit')}</option>{IMAGE_ZOOM_PERCENTAGES.map(percent=><option key={percent} value={percent}>{percent}%</option>)}</select></label>
 </div>
 <div role="group" aria-label={props.t('imageMode')}>
  {['side-by-side','overlay','swipe'].map(value=><button key={value} aria-pressed={presentation===value} onClick={()=>setPresentation(value)}>{props.t(value==='side-by-side'?'imageSideBySide':value==='overlay'?'imageOverlay':'imageSwipe')}</button>)}
  {presentation==='overlay'&&<label>{props.t('imageOpacity')} <input type="range" min="0" max="100" step="1" aria-label={props.t('imageOpacity')} value={opacity} onChange={event=>boundedPercent(event.target.value,setOpacity)}/><output>{opacity}%</output></label>}
  {presentation==='swipe'&&<label>{props.t('imageSplit')} <input type="range" min="0" max="100" step="1" aria-label={props.t('imageSplit')} value={split} onChange={event=>boundedPercent(event.target.value,setSplit)}/><output>{split}%</output></label>}
 </div>
 <div style={{display:'flex',flexWrap:'wrap',gap:16}}>{['left','right'].map(side=><ImageSide key={side} {...props} side={side} scale={scale} hidden={composite} onData={onData} scope={scope} dimensions={dimensions}/>)}</div>
 {composite&&(!usable?<p role="status">{props.t('imageCompositeUnavailable')}</p>:<><p>{props.t('imageRegistration')}</p><div role="region" aria-label={props.t('imageCompositeViewport')+' · '+props.t('imageViewport')} tabIndex={0} style={{maxWidth:'100%',maxHeight:480,overflow:'auto'}}><div data-image-canvas="true" style={{...canvas,position:'relative',overflow:'hidden'}}>{[left,right].map((data,index)=><img key={index} src={data.url} alt={props.t(index?'imageAfter':'imageBefore')+' · '+data.path} style={{position:'absolute',left:0,top:0,width:(data.width/dimensions.width*100)+'%',height:(data.height/dimensions.height*100)+'%',maxWidth:'none',maxHeight:'none',...(index?(presentation==='overlay'?{opacity:opacity/100}:{clipPath:'inset(0 '+(100-Math.min(100,split*dimensions.width/data.width))+'% 0 0)'}):{})}}/>)}</div></div></>)}
 </>}</div>;
}
