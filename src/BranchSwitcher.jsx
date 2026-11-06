import React,{useEffect,useRef,useState} from 'react';

// The preview token belongs only to this Session/repository view. A new owner
// cannot replay it; only the authenticated host knows the prepared snapshot.
export default function BranchSwitcher(props){
 return <ScopedBranchSwitcher key={JSON.stringify([props.sessionId,props.repositoryId,props.refresh,props.mode,props.scope])} {...props}/>;
}
const oid=value=>typeof value==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const copyBranch=value=>Object.freeze({name:value.name,ref:value.ref,commit:value.commit});
const branch=value=>value&&typeof value.name==='string'&&value.name.length>0&&value.ref==='refs/heads/'+value.name&&oid(value.commit);
function ScopedBranchSwitcher({sessionId,repositoryId,rpc,t,onSwitched,onRediscover,onUnknown,blocked=false,pending=false}){
 const [open,setOpen]=useState(false),[data,setData]=useState(null),[target,setTarget]=useState(''),[preview,setPreview]=useState(null),[busy,setBusy]=useState(''),[error,setError]=useState(''),[unknown,setUnknown]=useState(false);
 const task=useRef(null),locked=useRef(false),alive=useRef(true),prepared=useRef(null),confirming=useRef(false),uncertain=useRef(false),access=useRef(false),targetGeneration=useRef(0);
 const [,renderGeneration]=useState(0),generation=targetGeneration.current;
 // A selection is an event, not just a value: B → C → B must retire old handlers.
 const nextGeneration=()=>{const next=++targetGeneration.current;renderGeneration(next);return next;};
 access.current=!blocked&&!pending&&!unknown;
 const markUnknown=()=>{uncertain.current=true;setUnknown(true);onUnknown?.();};
 useEffect(()=>{alive.current=true;return()=>{if(confirming.current)onUnknown?.();alive.current=false;prepared.current=null;task.current?.abort();};},[]);
 const clearPreview=()=>{prepared.current=null;setPreview(null);};
 useEffect(()=>{
  if(!preview)return;
  const expire=()=>{if(prepared.current!==preview)return;nextGeneration();clearPreview();setError(t('branchExpired'));};
  const delay=preview.expiresAt-Date.now();if(delay<=0){expire();return;}
  const timer=setTimeout(expire,delay);return()=>clearTimeout(timer);
 },[preview]);
 const read=async()=>{
  if(generation!==targetGeneration.current||!alive.current||locked.current||uncertain.current||!access.current)return;locked.current=true;task.current?.abort();const controller=new AbortController();task.current=controller;
  let operationGeneration=nextGeneration();
  const current=()=>operationGeneration===targetGeneration.current&&task.current===controller&&!controller.signal.aborted&&alive.current&&access.current;
  clearPreview();setData(null);setTarget('');setError('');setBusy('read');setOpen(true);
  try{const value=await rpc('vcs/branches',{sessionId,repositoryId},controller.signal);
   if(!current())return;
   if(!branch(value?.current)||!Array.isArray(value.branches)||!value.branches.every(branch))throw Error(t('branchInvalid'));
   operationGeneration=nextGeneration();setData(Object.freeze({current:copyBranch(value.current),branches:Object.freeze(value.branches.map(copyBranch))}));
  }catch(e){if(current()){setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover?.();}}
  // Accepted lists advance the generation; only the owning task may release it.
  finally{if(operationGeneration===targetGeneration.current&&task.current===controller&&!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const prepare=async()=>{
  if(generation!==targetGeneration.current||!alive.current||locked.current||uncertain.current||!access.current||!data||!target)return;locked.current=true;const controller=new AbortController();task.current=controller;clearPreview();setError('');setBusy('prepare');
  let operationGeneration=generation;
  const current=()=>operationGeneration===targetGeneration.current&&task.current===controller&&!controller.signal.aborted&&alive.current&&access.current;
  try{const value=await rpc('vcs/branch-switch-prepare',{sessionId,repositoryId,branch:target},controller.signal);
   if(!current())return;
   if(!branch(value?.current)||!branch(value?.target)||value.target.name!==target||typeof value.token!=='string'||!/^[a-f0-9]{64}$/.test(value.token)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now()||value.expiresAt>Date.now()+61000)throw Error(t('branchInvalid'));
   const snapshot=Object.freeze({current:copyBranch(value.current),target:copyBranch(value.target),token:value.token,expiresAt:value.expiresAt});
   prepared.current=snapshot;setPreview(snapshot);
  }catch(e){if(current()){operationGeneration=nextGeneration();setError(e.message);setData(null);setTarget('');if(e.code==='vcs/rediscover-required')onRediscover?.();}}
  finally{if(operationGeneration===targetGeneration.current&&task.current===controller&&!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const confirm=async()=>{
  const value=prepared.current;
  if(!alive.current||locked.current||uncertain.current||!access.current||!value||value!==preview)return;
  if(value.expiresAt<=Date.now()){nextGeneration();clearPreview();setError(t('branchExpired'));return;}
  // Consume before awaiting: neither duplicate clicks nor errors reuse a token.
  locked.current=true;confirming.current=true;nextGeneration();clearPreview();setData(null);setTarget('');setBusy('confirm');setError('');
  const controller=new AbortController();task.current=controller;
  try{const result=await rpc('vcs/branch-switch-confirm',{sessionId,repositoryId,token:value.token},controller.signal);
   if(controller.signal.aborted||!alive.current)return;
   if(!branch(result?.current)||result.current.ref!==value.target.ref||result.current.commit!==value.target.commit)throw Error(t('branchInvalid'));
   confirming.current=false;setOpen(false);onSwitched?.();
  }catch(e){if(!controller.signal.aborted&&alive.current){confirming.current=false;markUnknown();setError(e.message);}}
  finally{if(!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const cancel=()=>{if(generation!==targetGeneration.current||!alive.current)return;nextGeneration();if(confirming.current){confirming.current=false;markUnknown();}task.current?.abort();locked.current=false;clearPreview();setBusy('');setError('');};
 const recover=()=>{if(alive.current&&!locked.current&&!pending)onSwitched?.();};
 const close=()=>{if(generation!==targetGeneration.current||!alive.current||locked.current||uncertain.current)return;nextGeneration();clearPreview();setOpen(false);setData(null);setTarget('');setError('');};
 return <section className="vcs-op vcs-branch-switcher" aria-label={t('branchSwitcher')} aria-busy={!!busy}>
 <div className="vcs-op-actions"><button disabled={!!busy||unknown||blocked||pending} aria-expanded={open} onClick={()=>open?close():read()}>{t('branchSwitcher')}</button></div>
 {(open||unknown||blocked)&&<><p>{t('branchScope')}</p>
 {busy==='confirm'&&<button onClick={cancel}>{t('branchCancel')}</button>}
 {busy&&<p role="status">{t(busy==='confirm'?'branchPending':'loading')}</p>}
 {(unknown||blocked)?<><p role="alert">{t('branchUnknown')} {error}</p><button disabled={!!busy||pending} onClick={recover}>{t('branchRecover')}</button></>:<>
 {error&&<p role="alert">{error}</p>}
 {!busy&&<button disabled={pending} onClick={read}>{t('branchRead')}</button>}
 {data&&!preview&&<><p>{t('branchCurrent')}: <code>{data.current.ref}</code> · <code>{data.current.commit}</code></p>
 <label>{t('branchTarget')} <select aria-label={t('branchTarget')} disabled={!!busy||blocked||pending} value={target} onChange={e=>{if(generation!==targetGeneration.current||!alive.current||locked.current||uncertain.current||!access.current)return;nextGeneration();clearPreview();setTarget(e.target.value);setError('');}}><option value="">—</option>{data.branches.map(row=><option key={row.ref} value={row.name} disabled={row.ref===data.current.ref}>{row.name} · {row.commit}</option>)}</select></label>
 <button disabled={!!busy||blocked||pending||!target} onClick={prepare}>{t('branchPrepare')}</button></>}
 {preview&&<section role="group" aria-label={t('branchConfirmation')}><p>{t('branchWarning')}</p>
 <p>{t('branchCurrent')}: <code>{preview.current.ref}</code> · <code>{preview.current.commit}</code></p>
 <p>{t('branchTarget')}: <code>{preview.target.ref}</code> · <code>{preview.target.commit}</code></p>
 <p>{t('branchExpires')}: <time dateTime={new Date(preview.expiresAt).toISOString()}>{new Date(preview.expiresAt).toLocaleTimeString()}</time></p>
 <button disabled={!!busy||blocked||pending} onClick={confirm}>{t('branchConfirm')}</button> <button disabled={!!busy} onClick={()=>{if(alive.current&&!locked.current&&prepared.current===preview){nextGeneration();clearPreview();}}}>{t('branchCancel')}</button>
 </section>}</>}
 </>}
 </section>;
}
