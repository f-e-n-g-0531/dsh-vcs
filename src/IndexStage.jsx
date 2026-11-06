import React,{useEffect,useRef,useState} from 'react';

// Scope owns the token and pending RPC; ignored aborts cannot publish late data.
export default function IndexStage(props){
 return <ScopedIndexStage key={JSON.stringify([props.sessionId,props.repositoryId,props.id,props.refresh,props.mode])} {...props}/>;
}
const oid=value=>typeof value==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const entry=value=>value&&oid(value.oid)&&['100644','100755'].includes(value.mode);
function ScopedIndexStage({sessionId,repositoryId,id,mode,rpc,t,onStaged,onRediscover,onUnknown,blocked=false,pending=false}){
 const [open,setOpen]=useState(false),[preview,setPreview]=useState(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[unknown,setUnknown]=useState(false);
 const task=useRef(null),locked=useRef(false),alive=useRef(true),prepared=useRef(null),ack=useRef(false),uncertain=useRef(false),confirming=useRef(false);
 useEffect(()=>{alive.current=true;return()=>{if(confirming.current){uncertain.current=true;onUnknown?.();}alive.current=false;prepared.current=null;ack.current=false;task.current?.abort();};},[]);
 const clearPreview=()=>{prepared.current=null;ack.current=false;setPreview(null);setChecked(false);};
 useEffect(()=>{
  if(!preview)return;
  const expire=()=>{if(prepared.current!==preview)return;clearPreview();setError(t('stageExpired'));};
  const delay=preview.expiresAt-Date.now();if(delay<=0){expire();return;}
  const timer=setTimeout(expire,delay);return()=>clearTimeout(timer);
 },[preview]);
 const prepare=async()=>{
  if(!alive.current||locked.current||uncertain.current||blocked||pending||mode!=='unstaged')return;
  locked.current=true;task.current?.abort();const controller=new AbortController();task.current=controller;
  clearPreview();setOpen(true);setBusy('prepare');setError('');
  try{const value=await rpc('vcs/index-stage-prepare',{sessionId,repositoryId,id},controller.signal);
   if(controller.signal.aborted||!alive.current)return;
   if(value?.action!=='stage'||typeof value.path!=='string'||!value.path||!oid(value.head)||!entry(value.index)||!entry(value.target)||value.index.oid.length!==value.head.length||value.target.oid.length!==value.head.length||typeof value.token!=='string'||!/^[a-f0-9]{64}$/.test(value.token)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now()||value.expiresAt>Date.now()+61000)throw Error(t('stageInvalid'));
   prepared.current=value;setPreview(value);
  }catch(e){if(!controller.signal.aborted&&alive.current){setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover?.();}}
  finally{if(!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const confirm=async()=>{
  const value=prepared.current;
  if(!alive.current||locked.current||uncertain.current||blocked||pending||!value||!ack.current)return;
  if(value.expiresAt<=Date.now()){clearPreview();setError(t('stageExpired'));return;}
  // Consume once, before awaiting. Every failed confirmation is outcome-unknown.
  locked.current=true;confirming.current=true;clearPreview();setBusy('confirm');setError('');
  const controller=new AbortController();task.current=controller;
  try{const result=await rpc('vcs/index-stage-confirm',{sessionId,repositoryId,token:value.token},controller.signal);
   if(controller.signal.aborted||!alive.current)return;
   if(result?.path!==value.path||result.head!==value.head||!entry(result.index)||result.index.oid!==value.target.oid||result.index.mode!==value.target.mode)throw Error(t('stageInvalid'));
   confirming.current=false;setOpen(false);onStaged();
  }catch(e){if(!controller.signal.aborted&&alive.current){confirming.current=false;uncertain.current=true;setUnknown(true);onUnknown?.();setError(e.message);}}
  finally{if(!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const close=()=>{
  if(!alive.current)return;
  // Cancelling a sent mutation cannot promise rollback; require explicit refresh.
  if(busy==='confirm'){confirming.current=false;uncertain.current=true;setUnknown(true);onUnknown?.();}
  task.current?.abort();locked.current=false;clearPreview();setBusy('');setOpen(false);setError('');
 };
 return <section aria-label={t('stageTitle')} aria-busy={!!busy} style={{padding:'0 12px',flexShrink:0,maxHeight:'45%',overflow:'auto'}}>
 <button disabled={!!busy||unknown||blocked||pending} aria-expanded={open} onClick={prepare}>{t('stagePrepare')}</button>
 {(unknown||blocked)?<><p role="alert">{t('stageUnknown')} {error}</p><button onClick={()=>{if(!locked.current)onStaged();}}>{t('stageRecover')}</button></>:open&&<>
 <p>{t('stageScope')}</p>{busy&&<p role="status">{t(busy==='confirm'?'stagePending':'loading')}</p>}{error&&<p role="alert">{error}</p>}
 {preview&&<section role="group" aria-label={t('stageConfirmation')}><p>{t('stageWarning')}</p>
 <p>{t('stagePath')}: <code>{preview.path}</code></p><p>HEAD: <code>{preview.head}</code></p>
 <p>{t('stageIndex')}: <code>{preview.index.oid}</code> · <code>{preview.index.mode}</code></p>
 <p>{t('stageTarget')}: <code>{preview.target.oid}</code> · <code>{preview.target.mode}</code></p>
 <p>{t('stageExpires')}: <time dateTime={new Date(preview.expiresAt).toISOString()}>{new Date(preview.expiresAt).toLocaleTimeString()}</time></p>
 <label><input type="checkbox" aria-label={t('stageAcknowledge')} checked={checked} onChange={e=>{ack.current=e.target.checked;setChecked(e.target.checked);}}/>{t('stageAcknowledge')}</label>
 <button disabled={!!busy||pending||!checked} onClick={confirm}>{t('stageConfirm')}</button></section>}
 <button onClick={close}>{t('stageCancel')}</button><button onClick={close}>{t('stageClose')}</button>
 </>}
 </section>;
}
