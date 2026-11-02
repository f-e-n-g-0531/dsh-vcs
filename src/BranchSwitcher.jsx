import React,{useEffect,useRef,useState} from 'react';

// The preview token belongs only to this Session/repository view. A new owner
// cannot replay it; only the authenticated host knows the prepared snapshot.
export default function BranchSwitcher(props){
 return <ScopedBranchSwitcher key={JSON.stringify([props.sessionId,props.repositoryId])} {...props}/>;
}
const oid=value=>typeof value==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const branch=value=>value&&typeof value.name==='string'&&value.name.length>0&&value.ref==='refs/heads/'+value.name&&oid(value.commit);
function ScopedBranchSwitcher({sessionId,repositoryId,rpc,t,onSwitched,onRediscover}){
 const [open,setOpen]=useState(false),[data,setData]=useState(null),[target,setTarget]=useState(''),[preview,setPreview]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[unknown,setUnknown]=useState(false);
 const task=useRef(null),locked=useRef(false),alive=useRef(true),prepared=useRef(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;prepared.current=null;task.current?.abort();};},[]);
 const clearPreview=()=>{prepared.current=null;setPreview(null);};
 useEffect(()=>{
  if(!preview)return;
  const expire=()=>{if(prepared.current!==preview)return;clearPreview();setError(t('branchExpired'));};
  const delay=preview.expiresAt-Date.now();if(delay<=0){expire();return;}
  const timer=setTimeout(expire,delay);return()=>clearTimeout(timer);
 },[preview]);
 const read=async()=>{
  if(locked.current||unknown)return;locked.current=true;task.current?.abort();const controller=new AbortController();task.current=controller;
  clearPreview();setData(null);setTarget('');setError('');setBusy('read');setOpen(true);
  try{const value=await rpc('vcs/branches',{sessionId,repositoryId},controller.signal);
   if(controller.signal.aborted||!alive.current)return;
   if(!branch(value?.current)||!Array.isArray(value.branches)||!value.branches.every(branch))throw Error(t('branchInvalid'));
   setData(value);
  }catch(e){if(!controller.signal.aborted&&alive.current){setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover?.();}}
  finally{if(!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const prepare=async()=>{
  if(locked.current||unknown||!data||!target)return;locked.current=true;const controller=new AbortController();task.current=controller;clearPreview();setError('');setBusy('prepare');
  try{const value=await rpc('vcs/branch-switch-prepare',{sessionId,repositoryId,branch:target},controller.signal);
   if(controller.signal.aborted||!alive.current)return;
   if(!branch(value?.current)||!branch(value?.target)||value.target.name!==target||typeof value.token!=='string'||!/^[a-f0-9]{64}$/.test(value.token)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now()||value.expiresAt>Date.now()+61000)throw Error(t('branchInvalid'));
   prepared.current=value;setPreview(value);
  }catch(e){if(!controller.signal.aborted&&alive.current){setError(e.message);setData(null);setTarget('');if(e.code==='vcs/rediscover-required')onRediscover?.();}}
  finally{if(!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const confirm=async()=>{
  const value=prepared.current;
  if(locked.current||unknown||!value)return;
  if(value.expiresAt<=Date.now()){clearPreview();setError(t('branchExpired'));return;}
  // Consume before awaiting: neither duplicate clicks nor errors reuse a token.
  locked.current=true;clearPreview();setData(null);setTarget('');setBusy('confirm');setError('');
  const controller=new AbortController();task.current=controller;
  try{const result=await rpc('vcs/branch-switch-confirm',{sessionId,repositoryId,token:value.token},controller.signal);
   if(controller.signal.aborted||!alive.current)return;
   if(!branch(result?.current)||result.current.ref!==value.target.ref||result.current.commit!==value.target.commit)throw Error(t('branchInvalid'));
   setOpen(false);onSwitched();
  }catch(e){if(!controller.signal.aborted&&alive.current){setUnknown(true);setError(e.message);}}
  finally{if(!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const close=()=>{if(locked.current||unknown)return;clearPreview();setOpen(false);setData(null);setTarget('');setError('');};
 return <section aria-label={t('branchSwitcher')} aria-busy={!!busy} style={{padding:'0 12px',flexShrink:0,maxHeight:'45%',overflow:'auto'}}>
 <button disabled={!!busy||unknown} aria-expanded={open} onClick={()=>open?close():read()}>{t('branchSwitcher')}</button>
 {open&&<><p>{t('branchScope')}</p>
 {busy&&<p role="status">{t(busy==='confirm'?'branchPending':'loading')}</p>}
 {unknown?<><p role="alert">{t('branchUnknown')} {error}</p><button onClick={()=>{if(!locked.current)onSwitched();}}>{t('branchRecover')}</button></>:<>
 {error&&<p role="alert">{error}</p>}
 {!busy&&<button onClick={read}>{t('branchRead')}</button>}
 {data&&!preview&&<><p>{t('branchCurrent')}: <code>{data.current.ref}</code> · <code>{data.current.commit}</code></p>
 <label>{t('branchTarget')} <select aria-label={t('branchTarget')} disabled={!!busy} value={target} onChange={e=>{clearPreview();setTarget(e.target.value);setError('');}}><option value="">—</option>{data.branches.map(row=><option key={row.ref} value={row.name} disabled={row.ref===data.current.ref}>{row.name} · {row.commit}</option>)}</select></label>
 <button disabled={!!busy||!target} onClick={prepare}>{t('branchPrepare')}</button></>}
 {preview&&<section role="group" aria-label={t('branchConfirmation')}><p>{t('branchWarning')}</p>
 <p>{t('branchCurrent')}: <code>{preview.current.ref}</code> · <code>{preview.current.commit}</code></p>
 <p>{t('branchTarget')}: <code>{preview.target.ref}</code> · <code>{preview.target.commit}</code></p>
 <p>{t('branchExpires')}: <time dateTime={new Date(preview.expiresAt).toISOString()}>{new Date(preview.expiresAt).toLocaleTimeString()}</time></p>
 <button disabled={!!busy} onClick={confirm}>{t('branchConfirm')}</button> <button disabled={!!busy} onClick={clearPreview}>{t('branchCancel')}</button>
 </section>}</>}
 </>}
 </section>;
}
