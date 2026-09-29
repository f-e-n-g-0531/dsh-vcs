import React,{useState,useEffect} from 'react';
export default function HistoryPanel({sessionId,repositoryId,rpc,t,onRediscover}){
 const [page,setPage]=useState({commits:[],snapshot:null,nextOffset:null}),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState('');
 // Parent remounts on repository/refresh changes; pagination stays anchored to first snapshot.
 useEffect(()=>{
  const controller=new AbortController();setBusy(true);setError('');
  rpc('vcs/history',{sessionId,repositoryId,offset,limit:50,...(offset?{snapshot:page.snapshot}:{})},controller.signal).then(value=>{
   if(!controller.signal.aborted)setPage(old=>({...value,commits:offset?[...old.commits,...value.commits]:value.commits}));
  }).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[sessionId,repositoryId,offset,retry]);
 return <section className="vcs-history" aria-label={t('history')} aria-busy={busy}>
 <p>{t('historyListOnly')}</p>
 <ol>{page.commits.map(commit=><li key={commit.id}><strong>{commit.subject}</strong><div><code title={commit.id}>{commit.id.slice(0,10)}</code> · {commit.author} · <time dateTime={commit.date}>{commit.date}</time></div></li>)}</ol>
 {busy&&<p role="status">{t('loading')}</p>}
 {error&&<p role="alert">{error} <button onClick={()=>setRetry(x=>x+1)}>{t('retry')}</button></p>}
 {!busy&&!error&&!page.commits.length&&<p>{t('historyEmpty')}</p>}
 {!error&&page.nextOffset!==null&&<button disabled={busy} onClick={()=>setOffset(page.nextOffset)}>{t('historyMore')}</button>}
 </section>;
}
