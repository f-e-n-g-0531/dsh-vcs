import React,{useState,useEffect,useRef} from 'react';
import CommitDetails from './CommitDetails.jsx';

// Remount before displaying anything from another session or repository.
export default function ReflogPanel(props){
 return <ScopedReflogPanel key={JSON.stringify([props.sessionId,props.repositoryId])} {...props}/>;
}
function ScopedReflogPanel({sessionId,repositoryId,rpc,t,onRediscover}){
 const [snapshot,setSnapshot]=useState(null),[selected,setSelected]=useState(null),[error,setError]=useState(''),[state,setState]=useState('loading'),[retry,setRetry]=useState(0);
 const pending=useRef(null);
 useEffect(()=>{
  const controller=new AbortController();pending.current=controller;
  setSnapshot(null);setSelected(null);setError('');setState('loading');
  rpc('vcs/reflog',{sessionId,repositoryId},controller.signal).then(value=>{
   if(controller.signal.aborted)return;
   if(!value||!Array.isArray(value.entries)||value.entries.length>200||typeof value.truncated!=='boolean'||value.entries.some(entry=>!entry||['id','selector','message','date'].some(key=>typeof entry[key]!=='string')||!entry.id))throw Error(t('reflogInvalid'));
   setSnapshot(value);setState('ready');
  }).catch(e=>{
   if(controller.signal.aborted)return;
   setError(e.message||t('error'));setState('error');
   if(e.code==='vcs/rediscover-required')onRediscover?.();
  });
  return()=>controller.abort();
 },[sessionId,repositoryId,retry]);
 const cancel=()=>{pending.current?.abort();setSnapshot(null);setSelected(null);setState('cancelled');};
 return <section aria-label={t('reflogTitle')}>
  <h3>{t('reflogTitle')}</h3><p>{t('reflogScope')}</p>
  {state==='loading'?<p role="status">{t('loading')} <button onClick={cancel}>{t('reflogCancel')}</button></p>:<button onClick={()=>setRetry(n=>n+1)}>{t('refresh')}</button>}
  {state==='cancelled'&&<p role="status">{t('reflogCancelled')} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>}
  {state==='error'&&<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>}
  {snapshot&&<>
   {snapshot.truncated&&<p role="status">{t('reflogTruncated')}</p>}
   {!snapshot.entries.length?<p role="status">{t('reflogEmpty')}</p>:<ol>{snapshot.entries.map((entry,index)=><li key={entry.selector+':'+index}><button aria-pressed={selected===index} onClick={()=>setSelected(index)}><code>{entry.selector}</code> · {entry.message} · <time>{entry.date}</time></button></li>)}</ol>}
   {selected!==null&&<CommitDetails sessionId={sessionId} repositoryId={repositoryId} commit={snapshot.entries[selected].id} rpc={rpc} t={t} onRediscover={onRediscover}/>}
  </>}
 </section>;
}
