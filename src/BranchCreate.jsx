import React,{useEffect,useRef,useState} from 'react';

const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(key=>Object.hasOwn(value,key));
const bytes=value=>{try{return encodeURIComponent(value).replace(/%[A-F0-9]{2}|[^%]/g,'x').length;}catch{return Infinity;}};
export const validBranchCreateName=name=>typeof name==='string'&&!!name&&bytes(name)<=1000&&name!=='@'&&name.toUpperCase()!=='HEAD'&&!name.startsWith('-')&&!name.startsWith('refs/')&&!/[\x00-\x20\x7f~^:?*\[\\<>"|\p{Cc}\p{Cf}]/u.test(name)&&!name.includes('..')&&!name.includes('@{')&&!name.split('/').some(p=>!p||bytes(p)>255||p.startsWith('.')||/[. ]$/.test(p)||p.toLowerCase().endsWith('.lock')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
const safeRef=value=>typeof value==='string'&&value.startsWith('refs/heads/')&&validBranchCreateName(value.slice(11));
const safeScope=value=>typeof value==='string'&&!!value&&bytes(value)<=4096&&!/[\p{Cc}\p{Cf}]/u.test(value);
export function captureBranchCreatePreview(value,submitted,now=Date.now()){
 if(!keys(value,['action','name','ref','target','head','currentRef','objectFormat','token','expiresAt']))return null;
 const width=value.objectFormat==='sha1'?40:value.objectFormat==='sha256'?64:0;
 const oid=id=>typeof id==='string'&&id.length===width&&/^[a-f0-9]+$/.test(id)&&!/^0+$/.test(id);
 if(value.action!=='branch-create'||!width||!validBranchCreateName(value.name)||value.name!==submitted.name||value.ref!=='refs/heads/'+submitted.name||!safeRef(value.ref)||!keys(value.target,['oid'])||!oid(value.target.oid)||!oid(value.head)||value.head!==value.target.oid||!safeRef(value.currentRef)||typeof value.token!=='string'||!/^[a-f0-9]{64}$/.test(value.token)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt>now+61000)return null;
 return Object.freeze({...value,target:Object.freeze({oid:value.target.oid})});
}
export default function BranchCreate(props){return <ScopedBranchCreate key={JSON.stringify([props.sessionId,props.repositoryId,props.refresh,props.mode,props.scope])} {...props}/>;}
function ScopedBranchCreate({sessionId,repositoryId,rpc,t,onCreated,onRediscover,onUnknown,blocked=false,pending=false}){
 const [name,setName]=useState(''),[preview,setPreview]=useState(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[unknown,setUnknown]=useState(false);
 const alive=useRef(true),task=useRef(null),locked=useRef(false),prepared=useRef(null),ack=useRef(false),confirming=useRef(false),uncertain=useRef(false),access=useRef(false);
 const draftGeneration=useRef(0),generation=draftGeneration.current,[,rerenderDraft]=useState(0);
 access.current=!blocked&&!pending&&!unknown&&safeScope(sessionId)&&safeScope(repositoryId);
 const clear=()=>{prepared.current=null;ack.current=false;setPreview(null);setChecked(false);};
 const markUnknown=()=>{uncertain.current=true;setUnknown(true);onUnknown?.();};
 useEffect(()=>{alive.current=true;return()=>{if(confirming.current)onUnknown?.();alive.current=false;prepared.current=null;ack.current=false;task.current?.abort();};},[]);
 useEffect(()=>{if(!preview)return;const expire=()=>{if(prepared.current===preview){clear();setError(t('branchCreateExpired'));}};const delay=preview.expiresAt-Date.now();if(delay<=0){expire();return;}const timer=setTimeout(expire,delay);return()=>clearTimeout(timer);},[preview]);
 const invalidate=()=>{if(confirming.current)return;draftGeneration.current++;rerenderDraft(n=>n+1);task.current?.abort();locked.current=false;clear();setBusy('');setError('');};
 const prepare=async()=>{
  if(!alive.current||locked.current||uncertain.current||!access.current||generation!==draftGeneration.current)return;
  const submitted=Object.freeze({sessionId,repositoryId,name});clear();setError('');if(!validBranchCreateName(name)){setError(t('branchCreateInvalidDraft'));return;}
  locked.current=true;const controller=new AbortController();task.current=controller;setBusy('prepare');
  try{const value=await rpc('vcs/branch-create-prepare',submitted,controller.signal);if(controller.signal.aborted||!alive.current||generation!==draftGeneration.current||!access.current)return;const snapshot=captureBranchCreatePreview(value,submitted);if(!snapshot)throw Error(t('branchCreateInvalid'));prepared.current=snapshot;setPreview(snapshot);}
  catch(e){if(!controller.signal.aborted&&alive.current&&generation===draftGeneration.current&&access.current){setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover?.();}}
  finally{if(!controller.signal.aborted&&alive.current&&generation===draftGeneration.current){locked.current=false;setBusy('');}}
 };
 const confirm=async()=>{
  const value=prepared.current;if(!alive.current||locked.current||uncertain.current||!access.current||!value||value!==preview||!ack.current)return;
  if(value.expiresAt<=Date.now()){clear();setError(t('branchCreateExpired'));return;}
  locked.current=true;confirming.current=true;clear();setBusy('confirm');setError('');const controller=new AbortController();task.current=controller;
  try{const result=await rpc('vcs/branch-create-confirm',{sessionId,repositoryId,token:value.token},controller.signal);if(controller.signal.aborted||!alive.current)return;
   if(!keys(result,['name','ref','commit','currentRef'])||result.name!==value.name||result.ref!==value.ref||result.commit!==value.target.oid||result.currentRef!==value.currentRef)throw Error(t('branchCreateInvalid'));
   confirming.current=false;setName('');onCreated?.();
  }catch(e){if(!controller.signal.aborted&&alive.current){confirming.current=false;markUnknown();setError(e.message);}}
  finally{if(!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const cancel=()=>{if(!alive.current||generation!==draftGeneration.current)return;draftGeneration.current++;rerenderDraft(n=>n+1);if(confirming.current){confirming.current=false;markUnknown();}task.current?.abort();locked.current=false;clear();setBusy('');setError('');};
 return <section className="vcs-op" aria-label={t('branchCreateTitle')} aria-busy={!!busy}>
 <h3>{t('branchCreateTitle')}</h3><details className="vcs-help"><summary>{t('operationDetails')}</summary><p>{t('branchCreateScope')}</p><p>{t('branchCreateBounds')}</p></details>
 <label>{t('branchCreateName')}<input aria-label={t('branchCreateName')} disabled={busy==='confirm'||unknown||blocked||pending} value={name} onChange={e=>{if(confirming.current||!alive.current)return;invalidate();setName(e.target.value);}}/></label>
 <div className="vcs-op-actions"><button disabled={!!busy||unknown||blocked||pending} onClick={prepare}>{t('branchCreatePrepare')}</button></div>
 {busy&&<p role="status">{t(busy==='confirm'?'branchCreatePending':'loading')}</p>}{error&&<p role="alert">{error}</p>}
 {(unknown||blocked)&&<><p role="alert">{t('branchCreateUnknown')}</p><button disabled={!!busy||pending} onClick={()=>{if(!locked.current)onRediscover?.();}}>{t('branchCreateRecover')}</button></>}
 {preview&&<section role="group" aria-label={t('branchCreateConfirmation')}><p>{t('branchCreateWarning')}</p><p>{t('branchCreateName')}: <code>{preview.name}</code></p><p>{t('branchCreateRef')}: <code>{preview.ref}</code></p><p>{t('branchCreateTarget')}: <code>{preview.target.oid}</code></p><p>HEAD: <code>{preview.head}</code></p><p>{t('branchCreateCurrentRef')}: <code>{preview.currentRef}</code></p><p>{t('commitFormat')}: <code>{preview.objectFormat}</code></p><p>{t('commitExpires')}: <time dateTime={new Date(preview.expiresAt).toISOString()}>{new Date(preview.expiresAt).toISOString()}</time></p>
 <label><input type="checkbox" aria-label={t('branchCreateAcknowledge')} checked={checked} onChange={e=>{if(!alive.current||prepared.current!==preview||confirming.current)return;ack.current=e.target.checked;setChecked(e.target.checked);}}/>{t('branchCreateAcknowledge')}</label><button disabled={!!busy||pending||blocked||!checked} onClick={confirm}>{t('branchCreateConfirm')}</button></section>}
 <button onClick={cancel}>{t('branchCreateCancel')}</button>
 </section>;
}
