import React,{useEffect,useState} from 'react';
function FileHistoryPages({sessionId,repositoryId,commit,parentIndex,id,follow,rpc,t,onRediscover,onSelectCommit}){
 const [page,setPage]=useState({commits:[],nextOffset:null}),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState('');
 useEffect(()=>{
  const controller=new AbortController();setBusy(true);setError('');
  rpc('vcs/file-history',{sessionId,repositoryId,commit,parentIndex,id,offset,limit:50,follow},controller.signal).then(value=>{if(!controller.signal.aborted)setPage(old=>({...value,commits:offset?[...old.commits,...value.commits]:value.commits}));}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[sessionId,repositoryId,commit,parentIndex,id,offset,retry]);
 return <section aria-label={t('fileHistory')} aria-busy={busy}><p>{t('fileHistoryScope')}</p><p style={{overflowWrap:'anywhere'}}>{page.path} · <code>{commit}</code></p>
 <ol>{page.commits.map(row=><li key={row.id}><code title={row.id}>{row.id.slice(0,10)}</code> · {onSelectCommit?<button onClick={()=>onSelectCommit(row.id,row.path||page.path)}>{row.subject}</button>:row.subject}<div>{row.boundary&&<span>{t(row.boundary==='merge-first-parent'?'fileHistoryMergeBoundary':'fileHistoryBoundary')} </span>}{row.path&&<code>{row.oldPath?row.oldPath+' → ':''}{row.path}</code>} {row.author} · <time dateTime={row.date}>{row.date}</time></div></li>)}</ol>
 {busy&&<p role="status">{t('loading')}</p>}
 {error&&<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>}
 {!busy&&!error&&!page.commits.length&&<p>{t('historyEmpty')}</p>}
 {page.truncated&&<p role="status">{t('historyLimit')}</p>}
 {!error&&page.nextOffset!==null&&<button disabled={busy} onClick={()=>setOffset(page.nextOffset)}>{t('historyMore')}</button>}
 </section>;
}
export default function FileHistory(props){
 return <ScopedFileHistory key={JSON.stringify([props.sessionId,props.repositoryId,props.commit,props.parentIndex,props.id])} {...props}/>;
}
function ScopedFileHistory(props){
 const [open,setOpen]=useState(false),[follow,setFollow]=useState(false);
 return <div><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{props.t('fileHistory')}</button>{open&&<><label><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/>{props.t('fileHistoryFollow')}</label><p>{props.t('fileHistoryFollowScope')}</p><FileHistoryPages key={String(follow)} follow={follow} {...props}/></>}</div>;
}
