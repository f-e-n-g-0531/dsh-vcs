import React,{useEffect,useRef,useState} from 'react';
import {validBranchCreateName} from './BranchCreate.jsx';

const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(key=>Object.hasOwn(value,key));
const bytes=value=>{try{return encodeURIComponent(value).replace(/%[A-F0-9]{2}|[^%]/g,'x').length;}catch{return Infinity;}};
const text=(value,max)=>typeof value==='string'&&bytes(value)<=max;
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const identityKeys=['name','email','timestamp','timezone'];
function validIdentity(value){
 if(!keys(value,identityKeys))return false;
 for(const key of ['name','email'])if(!text(value[key],1024)||!value[key].trim()||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/u.test(value[key]))return false;
 if(!Number.isSafeInteger(value.timestamp)||value.timestamp<0||typeof value.timezone!=='string'||!/^[-+][0-9]{4}$/.test(value.timezone))return false;
 const hours=Number(value.timezone.slice(1,3)),minutes=Number(value.timezone.slice(3));return hours<=14&&minutes<60&&(hours!==14||minutes===0);
}
const validMessage=value=>text(value,65536)&&!!value.trim()&&!/[\p{Cc}]/u.test(value.replace(/[\r\n\t]/g,''))&&!value.includes('-----BEGIN PGP SIGNATURE-----');
const sameIdentity=(a,b)=>validIdentity(a)&&identityKeys.every(key=>a[key]===b[key]);
const safeRef=value=>typeof value==='string'&&value.startsWith('refs/heads/')&&validBranchCreateName(value.slice(11));
const safeScope=value=>typeof value==='string'&&!!value&&bytes(value)<=4096&&!/[\p{Cc}\p{Cf}]/u.test(value);
export function captureTagCreatePreview(value,submitted,now=Date.now()){
 if(!keys(value,['action','name','ref','objectFormat','head','currentRef','targetTree','tagger','message','messageBytes','object','planId','token','expiresAt']))return null;
 const width=value.objectFormat==='sha1'?40:value.objectFormat==='sha256'?64:0;
 const oid=id=>typeof id==='string'&&id.length===width&&/^[a-f0-9]+$/.test(id)&&!/^0+$/.test(id);
 if(value.action!=='tag-create'||!width||!validBranchCreateName(value.name)||value.name!==submitted.name||value.ref!=='refs/tags/'+submitted.name||!keys(value.object,['oid'])||!oid(value.object.oid)||!oid(value.head)||!oid(value.targetTree)||!safeRef(value.currentRef)||!sameIdentity(value.tagger,submitted.tagger)||!validMessage(value.message)||value.message!==submitted.message||!Number.isSafeInteger(value.messageBytes)||value.messageBytes!==bytes(value.message)||!hex(value.planId)||!hex(value.token)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt>now+61000)return null;
 return Object.freeze({...value,tagger:Object.freeze({...value.tagger}),object:Object.freeze({oid:value.object.oid})});
}

export default function TagCreate(props){return <ScopedTagCreate key={JSON.stringify([props.sessionId,props.repositoryId,props.refresh,props.mode,props.scope])} {...props}/>;}
function ScopedTagCreate({sessionId,repositoryId,rpc,t,onCreated,onRediscover,onUnknown,blocked=false,pending=false}){
 const [tagger,setTagger]=useState(()=>({name:'',email:'',timestamp:'',timezone:''})),[message,setMessage]=useState('');
 const [name,setName]=useState(''),[preview,setPreview]=useState(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[unknown,setUnknown]=useState(false);
 const alive=useRef(true),task=useRef(null),locked=useRef(false),prepared=useRef(null),ack=useRef(false),confirming=useRef(false),uncertain=useRef(false),access=useRef(false);
 const draftGeneration=useRef(0),generation=draftGeneration.current,[,rerenderDraft]=useState(0);
 access.current=!blocked&&!pending&&!unknown&&safeScope(sessionId)&&safeScope(repositoryId);
 const clear=()=>{prepared.current=null;ack.current=false;setPreview(null);setChecked(false);};
 const markUnknown=()=>{uncertain.current=true;setUnknown(true);onUnknown?.();};
 useEffect(()=>{alive.current=true;return()=>{if(confirming.current)onUnknown?.();alive.current=false;prepared.current=null;ack.current=false;task.current?.abort();};},[]);
 useEffect(()=>{if(!preview)return;const expire=()=>{if(prepared.current===preview){clear();setError(t('tagCreateExpired'));}};const delay=preview.expiresAt-Date.now();if(delay<=0){expire();return;}const timer=setTimeout(expire,delay);return()=>clearTimeout(timer);},[preview]);
 const invalidate=()=>{if(confirming.current)return;draftGeneration.current++;rerenderDraft(n=>n+1);task.current?.abort();locked.current=false;clear();setBusy('');setError('');};
 const prepare=async()=>{
  if(!alive.current||locked.current||uncertain.current||!access.current||generation!==draftGeneration.current)return;
  const submitted=Object.freeze({sessionId,repositoryId,name,tagger:Object.freeze({...tagger,timestamp:/^(0|[1-9][0-9]*)$/.test(tagger.timestamp)?Number(tagger.timestamp):NaN}),message});clear();setError('');if(!validBranchCreateName(name)||!validIdentity(submitted.tagger)||!validMessage(message)){setError(t('tagCreateInvalidDraft'));return;}
  locked.current=true;const controller=new AbortController();task.current=controller;setBusy('prepare');
  try{const value=await rpc('vcs/tag-create-prepare',submitted,controller.signal);if(controller.signal.aborted||!alive.current)return;const snapshot=captureTagCreatePreview(value,submitted);if(!snapshot)throw Error(t('tagCreateInvalid'));prepared.current=snapshot;setPreview(snapshot);}
  catch(e){if(!controller.signal.aborted&&alive.current){setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover?.();}}
  finally{if(!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const confirm=async()=>{
  const value=prepared.current;if(!alive.current||locked.current||uncertain.current||!access.current||!value||value!==preview||!ack.current)return;
  if(value.expiresAt<=Date.now()){clear();setError(t('tagCreateExpired'));return;}
  locked.current=true;confirming.current=true;clear();setBusy('confirm');setError('');const controller=new AbortController();task.current=controller;
  try{const result=await rpc('vcs/tag-create-confirm',{sessionId,repositoryId,token:value.token},controller.signal);if(controller.signal.aborted||!alive.current)return;
   if(!keys(result,['name','ref','tagOid','commit','currentRef'])||result.name!==value.name||result.ref!==value.ref||result.tagOid!==value.object.oid||result.commit!==value.head||result.currentRef!==value.currentRef)throw Error(t('tagCreateInvalid'));
   confirming.current=false;setName('');setTagger({name:'',email:'',timestamp:'',timezone:''});setMessage('');onCreated?.();
  }catch(e){if(!controller.signal.aborted&&alive.current){confirming.current=false;markUnknown();setError(e.message);}}
  finally{if(!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const cancel=()=>{if(!alive.current||generation!==draftGeneration.current)return;draftGeneration.current++;rerenderDraft(n=>n+1);if(confirming.current){confirming.current=false;markUnknown();}task.current?.abort();locked.current=false;clear();setBusy('');setError('');};
 return <section aria-label={t('tagCreateTitle')} aria-busy={!!busy} style={{padding:'0 12px',maxHeight:'50%',overflow:'auto',flexShrink:0}}>
 <h3>{t('tagCreateTitle')}</h3><p>{t('tagCreateScope')}</p><p>{t('tagCreateBounds')}</p>
 <label>{t('tagCreateName')}<input aria-label={t('tagCreateName')} disabled={busy==='confirm'||unknown||blocked||pending} value={name} onChange={e=>{if(confirming.current||!alive.current)return;invalidate();setName(e.target.value);}}/></label>
 <fieldset disabled={busy==='confirm'||unknown||blocked||pending}><legend>{t('tagCreateTagger')}</legend>{identityKeys.map(key=><label key={key}>{t('commit'+key)}<input aria-label={t('tagCreateTagger')+' '+t('commit'+key)} value={tagger[key]} onChange={e=>{if(confirming.current||!alive.current)return;invalidate();setTagger({...tagger,[key]:e.target.value});}}/></label>)}</fieldset>
 <label>{t('tagCreateMessage')}<textarea aria-label={t('tagCreateMessage')} disabled={busy==='confirm'||unknown||blocked||pending} value={message} onChange={e=>{if(confirming.current||!alive.current)return;invalidate();setMessage(e.target.value);}}/></label>
 <button disabled={!!busy||unknown||blocked||pending} onClick={prepare}>{t('tagCreatePrepare')}</button>
 {busy&&<p role="status">{t(busy==='confirm'?'tagCreatePending':'loading')}</p>}{error&&<p role="alert">{error}</p>}
 {(unknown||blocked)&&<><p role="alert">{t('tagCreateUnknown')}</p><button disabled={!!busy||pending} onClick={()=>{if(!locked.current)onRediscover?.();}}>{t('tagCreateRecover')}</button></>}
 {preview&&<section role="group" aria-label={t('tagCreateConfirmation')}><p>{t('tagCreateWarning')}</p><p>{t('tagCreateName')}: <code>{preview.name}</code></p><p>{t('tagCreateRef')}: <code>{preview.ref}</code></p><p>{t('tagCreateTarget')}: <code>{preview.object.oid}</code></p><p>HEAD: <code>{preview.head}</code></p><p>{t('tagCreateCurrentRef')}: <code>{preview.currentRef}</code></p><p>Tree: <code>{preview.targetTree}</code></p>{identityKeys.map(key=><p key={key}>{t('commit'+key)}: <code>{String(preview.tagger[key])}</code></p>)}<pre style={{whiteSpace:'pre-wrap'}}>{preview.message}</pre><p>{t('tagCreateMessageBytes')}: {preview.messageBytes}</p><p>{t('commitFormat')}: <code>{preview.objectFormat}</code></p><p>{t('commitExpires')}: <time dateTime={new Date(preview.expiresAt).toISOString()}>{new Date(preview.expiresAt).toISOString()}</time></p>
 <label><input type="checkbox" aria-label={t('tagCreateAcknowledge')} checked={checked} onChange={e=>{if(!alive.current||prepared.current!==preview||confirming.current)return;ack.current=e.target.checked;setChecked(e.target.checked);}}/>{t('tagCreateAcknowledge')}</label><button disabled={!!busy||pending||blocked||!checked} onClick={confirm}>{t('tagCreateConfirm')}</button></section>}
 <button onClick={cancel}>{t('tagCreateCancel')}</button>
 </section>;
}
