import React,{useState,useEffect,useRef} from 'react';
// Repository/Session changes create a fresh request owner and empty view state.
export default function GrepPanel(props){
 return <ScopedGrepPanel key={JSON.stringify([props.sessionId,props.repositoryId])} {...props}/>;
}
function ScopedGrepPanel({sessionId,repositoryId,rpc,t,onRediscover}){
 const [draft,setDraft]=useState(''),[lastQuery,setLastQuery]=useState(null),[matches,setMatches]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const controller=useRef(null);
 const search=query=>{controller.current?.abort();const c=new AbortController();controller.current=c;setBusy(true);setError('');setMatches(null);setLastQuery(query);rpc('vcs/grep',{sessionId,repositoryId,query},c.signal).then(value=>{if(!c.signal.aborted)setMatches(value.matches);}).catch(e=>{if(c.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();}).finally(()=>{if(!c.signal.aborted)setBusy(false);});};
 useEffect(()=>()=>controller.current?.abort(),[]);
 const submit=e=>{e.preventDefault();const q=draft.trim();if(q)search(q);};
 return <section aria-label={t('grepTitle')}><h3>{t('grepTitle')}</h3><p>{t('grepScope')}</p>
  <form onSubmit={submit}><input aria-label={t('grepQuery')} maxLength={1024} placeholder={t('grepPlaceholder')} value={draft} onChange={e=>setDraft(e.target.value)}/><button type="submit" disabled={busy||!draft.trim()}>{t('grepRun')}</button></form>
  {error?<p role="alert">{error} <button onClick={()=>lastQuery&&search(lastQuery)}>{t('retry')}</button></p>:busy?<p role="status">{t('loading')}</p>:matches&&<><p role="status">{t('grepCount',{count:matches.length})}</p>{!matches.length?<p role="status">{t('grepEmpty')}</p>:<ol>{matches.map((m,i)=><li key={i}><code>{m.path}:{m.line}</code> <pre style={{margin:0}}>{m.text}</pre></li>)}</ol>}</>}
 </section>;
}