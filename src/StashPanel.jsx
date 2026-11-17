import React,{useState,useEffect} from 'react';
import CommitDetails from './CommitDetails.jsx';
export default function StashPanel({sessionId,repositoryId,rpc,t,onRediscover}){
 const [stashes,setStashes]=useState(null),[selected,setSelected]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setError('');setStashes(null);setSelected(null);rpc('vcs/stash-list',{sessionId,repositoryId},controller.signal).then(value=>{if(!controller.signal.aborted)setStashes(value.stashes);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});return()=>controller.abort();},[sessionId,repositoryId,retry]);
 if(error)return <section aria-label={t('stashTitle')}><h3>{t('stashTitle')}</h3><p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p></section>;
 if(!stashes)return <section aria-label={t('stashTitle')}><h3>{t('stashTitle')}</h3><p role="status">{t('loading')}</p></section>;
 return <section className="vcs-snapshot-panel" aria-label={t('stashTitle')}><div className="vcs-snapshot-heading"><h3>{t('stashTitle')}</h3><p>{t('stashScope')}</p></div><div className="vcs-snapshot-list">
  {!stashes.length?<p role="status">{t('stashEmpty')}</p>:<ol>{stashes.map(s=><li key={s.id}><button aria-pressed={selected===s.id} onClick={()=>setSelected(s.id)}><code className="vcs-snapshot-ref">{s.ref}</code><span className="vcs-snapshot-subject">{s.message}</span></button></li>)}</ol>}
  </div><div className="vcs-snapshot-details">{selected&&<CommitDetails sessionId={sessionId} repositoryId={repositoryId} commit={selected} rpc={rpc} t={t} onRediscover={onRediscover}/>}
 </div></section>;
}