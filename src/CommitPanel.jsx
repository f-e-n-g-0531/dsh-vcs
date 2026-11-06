import React,{useEffect,useRef,useState} from 'react';

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
const validMessage=value=>text(value,65536)&&!!value.trim()&&!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value.replace(/[\n\t]/g,''));
const sameIdentity=(a,b)=>validIdentity(a)&&identityKeys.every(key=>a[key]===b[key]);
const safeRef=value=>text(value,1024)&&!/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)&&value.startsWith('refs/heads/')&&value.split('/').every(part=>part&&!part.startsWith('.')&&!part.endsWith('.')&&!part.endsWith('.lock'))&&!/[\x00-\x20\x7f~^:?*\[\\]/.test(value)&&!value.includes('..')&&!value.includes('@{');
export function captureCommitPreview(value,submitted,now=Date.now()){
 if(!keys(value,['action','head','ref','objectFormat','indexDigest','tree','commit','author','committer','message','token','expiresAt']))return null;
 const width=value.objectFormat==='sha1'?40:value.objectFormat==='sha256'?64:0;
 const oid=id=>typeof id==='string'&&id.length===width&&/^[a-f0-9]+$/.test(id)&&!/^0+$/.test(id);
 if(value.action!=='commit'||!width||!oid(value.head)||!oid(value.tree)||!keys(value.commit,['oid'])||!oid(value.commit.oid)||!safeRef(value.ref)||!hex(value.indexDigest)||!hex(value.token)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt>now+61000||!sameIdentity(value.author,submitted.author)||!sameIdentity(value.committer,submitted.committer)||!validMessage(value.message)||value.message!==submitted.message)return null;
 return Object.freeze({...value,author:Object.freeze({...value.author}),committer:Object.freeze({...value.committer}),commit:Object.freeze({oid:value.commit.oid})});
}
export function captureLatestCommit(value){
 if(!keys(value,['head','ref','objectFormat','tree','parents','author','committer','message','messageBytes']))return null;
 const width=value.objectFormat==='sha1'?40:value.objectFormat==='sha256'?64:0;
 const oid=id=>typeof id==='string'&&id.length===width&&/^[a-f0-9]+$/.test(id)&&!/^0+$/.test(id);
 if(!width||!oid(value.head)||!oid(value.tree)||!safeRef(value.ref)||!Array.isArray(value.parents)||value.parents.length>16||!value.parents.every(oid)||new Set(value.parents).size!==value.parents.length||!validIdentity(value.author)||!validIdentity(value.committer)||!text(value.message,65536)||/[\p{Cc}]/u.test(value.message.replace(/[\n\t\r]/g,''))||!Number.isSafeInteger(value.messageBytes)||value.messageBytes!==bytes(value.message))return null;
 return Object.freeze({...value,parents:Object.freeze([...value.parents]),author:Object.freeze({...value.author}),committer:Object.freeze({...value.committer})});
}
const initialIdentity=()=>{const offset=-new Date().getTimezoneOffset(),absolute=Math.abs(offset);return {name:'',email:'',timestamp:String(Math.floor(Date.now()/1000)),timezone:(offset<0?'-':'+')+String(Math.floor(absolute/60)).padStart(2,'0')+String(absolute%60).padStart(2,'0')};};
export default function CommitPanel(props){return <ScopedCommitPanel key={JSON.stringify([props.sessionId,props.repositoryId,props.refresh,props.mode,props.scope])} {...props}/>;}
function ScopedCommitPanel({sessionId,repositoryId,mode,rpc,t,onCommitted,onRediscover,onUnknown,blocked=false,pending=false}){
 const [author,setAuthor]=useState(initialIdentity),[committer,setCommitter]=useState(initialIdentity),[message,setMessage]=useState(''),[preview,setPreview]=useState(null),[checked,setChecked]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[unknown,setUnknown]=useState(false);
 const [latest,setLatest]=useState(null),[latestBusy,setLatestBusy]=useState(false),[latestError,setLatestError]=useState('');
 const latestTask=useRef(null),latestSnapshot=useRef(null),access=useRef(false);
 const alive=useRef(true),task=useRef(null),locked=useRef(false),prepared=useRef(null),ack=useRef(false),confirming=useRef(false),uncertain=useRef(false);
 const draftGeneration=useRef(0),generation=draftGeneration.current,[,rerenderDraft]=useState(0);
 access.current=!blocked&&!pending&&!unknown&&mode==='staged';
 const stopLatest=()=>{latestTask.current?.abort();latestTask.current=null;setLatestBusy(false);};
 const clear=()=>{prepared.current=null;ack.current=false;setPreview(null);setChecked(false);};
 const markUnknown=()=>{uncertain.current=true;setUnknown(true);onUnknown?.();};
 useEffect(()=>{alive.current=true;return()=>{if(confirming.current)onUnknown?.();alive.current=false;prepared.current=null;ack.current=false;task.current?.abort();latestTask.current?.abort();latestSnapshot.current=null;};},[]);
 useEffect(()=>{if(!preview)return;const expire=()=>{if(prepared.current===preview){clear();setError(t('commitExpired'));}};const delay=preview.expiresAt-Date.now();if(delay<=0){expire();return;}const timer=setTimeout(expire,delay);return()=>clearTimeout(timer);},[preview]);
 const invalidate=()=>{if(confirming.current)return;draftGeneration.current++;rerenderDraft(n=>n+1);task.current?.abort();locked.current=false;clear();setBusy('');setError('');};
 useEffect(()=>{if(blocked||pending||unknown)stopLatest();},[blocked,pending,unknown]);
 const canLatest=()=>alive.current&&access.current&&!confirming.current&&!uncertain.current;
 const loadLatest=async()=>{
  if(!canLatest()||latestTask.current)return;
  const controller=new AbortController();latestTask.current=controller;setLatestBusy(true);setLatestError('');latestSnapshot.current=null;setLatest(null);
  try{const value=await rpc('vcs/latest-commit',{sessionId,repositoryId},controller.signal);if(controller.signal.aborted||latestTask.current!==controller||!canLatest())return;const snapshot=captureLatestCommit(value);if(!snapshot)throw Error(t('commitLatestInvalid'));latestSnapshot.current=snapshot;setLatest(snapshot);}
  catch(e){if(!controller.signal.aborted&&latestTask.current===controller&&canLatest())setLatestError(e.message);}
  finally{if(latestTask.current===controller){latestTask.current=null;if(alive.current)setLatestBusy(false);}}
 };
 const reuseLatest=()=>{
  if(!canLatest()||!latest||latestSnapshot.current!==latest)return;
  invalidate();setMessage(latest.message);
 };
 const prepare=async()=>{
  if(!alive.current||locked.current||uncertain.current||!access.current||generation!==draftGeneration.current)return;
  const convert=value=>({...value,timestamp:/^(0|[1-9][0-9]*)$/.test(value.timestamp)?Number(value.timestamp):NaN});
  const submitted=Object.freeze({sessionId,repositoryId,author:Object.freeze(convert(author)),committer:Object.freeze(convert(committer)),message});
  clear();setError('');if(!validIdentity(submitted.author)||!validIdentity(submitted.committer)||!validMessage(message)){setError(t('commitInvalidDraft'));return;}
  locked.current=true;const controller=new AbortController();task.current=controller;setBusy('prepare');
  try{const value=await rpc('vcs/commit-prepare',submitted,controller.signal);if(controller.signal.aborted||!alive.current||generation!==draftGeneration.current||task.current!==controller||!access.current)return;const snapshot=captureCommitPreview(value,submitted);if(!snapshot)throw Error(t('commitInvalid'));prepared.current=snapshot;setPreview(snapshot);}
  catch(e){if(!controller.signal.aborted&&alive.current&&generation===draftGeneration.current&&task.current===controller&&access.current){setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover?.();}}
  finally{if(!controller.signal.aborted&&alive.current&&generation===draftGeneration.current&&task.current===controller){locked.current=false;setBusy('');}}
 };
 const confirm=async()=>{
  const value=prepared.current;if(!alive.current||locked.current||uncertain.current||blocked||pending||!value||value!==preview||!ack.current)return;
  if(value.expiresAt<=Date.now()){clear();setError(t('commitExpired'));return;}
  locked.current=true;confirming.current=true;stopLatest();clear();setBusy('confirm');setError('');const controller=new AbortController();task.current=controller;
  try{const result=await rpc('vcs/commit-confirm',{sessionId,repositoryId,token:value.token},controller.signal);if(controller.signal.aborted||!alive.current)return;
   if(!keys(result,['head','ref','tree','indexDigest'])||result.head!==value.commit.oid||result.ref!==value.ref||result.tree!==value.tree||result.indexDigest!==value.indexDigest)throw Error(t('commitInvalid'));
   confirming.current=false;setAuthor(initialIdentity());setCommitter(initialIdentity());setMessage('');onCommitted();
  }catch(e){if(!controller.signal.aborted&&alive.current){confirming.current=false;markUnknown();setError(e.message);}}
  finally{if(!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const cancel=()=>{if(!alive.current||generation!==draftGeneration.current)return;draftGeneration.current++;rerenderDraft(n=>n+1);stopLatest();latestSnapshot.current=null;setLatest(null);setLatestError('');if(confirming.current){confirming.current=false;markUnknown();}task.current?.abort();locked.current=false;clear();setBusy('');setError('');};
 const identityForm=(value,setValue,label)=><fieldset disabled={busy==='confirm'||unknown||blocked||pending}><legend>{t(label)}</legend>{identityKeys.map(key=><label key={key}>{t('commit'+key)}<input aria-label={t(label)+' '+t('commit'+key)} value={value[key]} onChange={e=>{if(confirming.current||!alive.current)return;invalidate();setValue({...value,[key]:e.target.value});}}/></label>)}</fieldset>;
 return <section aria-label={t('commitTitle')} aria-busy={!!busy} style={{padding:'0 12px',maxHeight:'50%',overflow:'auto',flexShrink:0}}>
 <h3>{t('commitTitle')}</h3><p>{t('commitScope')}</p><p>{t('commitDefaults')}</p>
 <section aria-label={t('commitLatestTitle')}><h4>{t('commitLatestTitle')}</h4><p>{t('commitLatestScope')}</p>
 <button disabled={latestBusy||busy==='confirm'||unknown||blocked||pending||mode!=='staged'} onClick={loadLatest}>{t('commitLatestLoad')}</button>
 {latestBusy&&<><p role="status">{t('loading')}</p><button onClick={()=>{if(alive.current)stopLatest();}}>{t('commitLatestCancel')}</button></>}{latestError&&<p role="alert">{latestError}</p>}
 {latest&&<><p>HEAD: <code>{latest.head}</code></p><p>{t('commitRef')}: <code>{latest.ref}</code></p><p>{t('commitFormat')}: <code>{latest.objectFormat}</code></p><p>Tree: <code>{latest.tree}</code></p>{latest.parents.map(parent=><p key={parent}>Parent: <code>{parent}</code></p>)}
 {['author','committer'].map(role=><div key={role}><strong>{t(role==='author'?'commitAuthor':'commitCommitter')}</strong>{identityKeys.map(key=><p key={key}>{t('commit'+key)}: <code>{String(latest[role][key])}</code></p>)}</div>)}
 <pre aria-label={t('commitLatestMessage')} style={{whiteSpace:'pre-wrap'}}>{latest.message}</pre><p>{t('commitLatestBytes')}: {latest.messageBytes}</p><p>{t('commitLatestReuseNotice')}</p>
 <button disabled={busy==='confirm'||unknown||blocked||pending||mode!=='staged'} onClick={reuseLatest}>{t('commitLatestReuse')}</button></>}
 </section>
 {identityForm(author,setAuthor,'commitAuthor')}{identityForm(committer,setCommitter,'commitCommitter')}
 <label>{t('commitMessage')}<textarea aria-label={t('commitMessage')} disabled={busy==='confirm'||unknown||blocked||pending} value={message} onChange={e=>{if(confirming.current||!alive.current)return;invalidate();setMessage(e.target.value);}}/></label>
 <button disabled={!!busy||unknown||blocked||pending} onClick={prepare}>{t('commitPrepare')}</button>
 <button disabled={!!busy||pending} onClick={()=>{if(!alive.current||locked.current)return;invalidate();setAuthor(initialIdentity());setCommitter(initialIdentity());setMessage('');}}>{t('commitClearDraft')}</button>
 {busy&&<p role="status">{t(busy==='confirm'?'commitPending':'loading')}</p>}{error&&<p role="alert">{error}</p>}
 {(unknown||blocked)&&<><p role="alert">{t('commitUnknown')}</p><button disabled={!!busy||pending} onClick={()=>{if(!locked.current)onRediscover?.();}}>{t('commitRecover')}</button></>}
 {preview&&<section role="group" aria-label={t('commitConfirmation')}><p>{t('commitWarning')}</p><p>HEAD: <code>{preview.head}</code></p><p>{t('commitRef')}: <code>{preview.ref}</code></p><p>{t('commitFormat')}: <code>{preview.objectFormat}</code></p><p>Index SHA-256: <code>{preview.indexDigest}</code></p><p>Tree: <code>{preview.tree}</code></p><p>Commit: <code>{preview.commit.oid}</code></p>
 {['author','committer'].map(role=><div key={role}><strong>{t(role==='author'?'commitAuthor':'commitCommitter')}</strong>{identityKeys.map(key=><p key={key}>{t('commit'+key)}: <code>{String(preview[role][key])}</code></p>)}</div>)}<pre style={{whiteSpace:'pre-wrap'}}>{preview.message}</pre><p>{t('commitExpires')}: <time dateTime={new Date(preview.expiresAt).toISOString()}>{new Date(preview.expiresAt).toISOString()}</time></p>
 <label><input type="checkbox" aria-label={t('commitAcknowledge')} checked={checked} onChange={e=>{if(!alive.current||prepared.current!==preview||confirming.current)return;ack.current=e.target.checked;setChecked(e.target.checked);}}/>{t('commitAcknowledge')}</label><button disabled={!!busy||pending||blocked||!checked} onClick={confirm}>{t('commitConfirm')}</button></section>}
 <button onClick={cancel}>{t('commitCancel')}</button>
 </section>;
}
