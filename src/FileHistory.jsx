import React,{useEffect,useState} from 'react';
function FileHistoryPages({sessionId,repositoryId,commit,parentIndex,id,rpc,t,onRediscover,onSelectCommit}){
 const [page,setPage]=useState({commits:[],nextOffset:null}),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();setBusy(true);setError('');
  rpc('vcs/file-history',{sessionId,repositoryId,commit,parentIndex,id,offset,limit:50},controller.signal).then(value=>{if(!controller.signal.aborted)setPage(old=>({...value,commits:offset?[...old.commits,...value.commits]:value.commits}));}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[sessionId,repositoryId,commit,parentIndex,id,offset,retry]);
 return <section aria-label={t('fileHistory')} aria-busy={busy}><p>{t('fileHistoryScope')}</p><p style={{overflowWrap:'anywhere'}}>{page.path} · <code>{commit}</code></p>
 <ol>{page.commits.map(row=><li key={row.id}><code title={row.id}>{row.id.slice(0,10)}</code> · {onSelectCommit?<button onClick={()=>onSelectCommit(row.id)}>{row.subject}</button>:row.subject}<div>{row.author} · <time dateTime={row.date}>{row.date}</time></div></li>)}</ol>
 {busy&&<p role="status">{t('loading')}</p>}
 {error&&<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>}
 {!busy&&!error&&!page.commits.length&&<p>{t('historyEmpty')}</p>}
 {page.truncated&&<p role="status">{t('historyLimit')}</p>}
 {!error&&page.nextOffset!==null&&<button disabled={busy} onClick={()=>setOffset(page.nextOffset)}>{t('historyMore')}</button>}
 </section>;
}
export default function FileHistory(props){
 const [open,setOpen]=useState(false);
 return <div><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{props.t('fileHistory')}</button>{open&&<FileHistoryPages {...props}/>}</div>;
}
