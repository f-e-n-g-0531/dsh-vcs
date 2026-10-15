import React,{useEffect,useState} from 'react';
function FileHistoryPages({sessionId,repositoryId,commit,parentIndex,id,follow,since,until,rpc,t,onRediscover,onSelectCommit}){
 const [page,setPage]=useState({commits:[],nextOffset:null}),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState('');
 const date={...(since?{since}:{}),...(until?{until}:{})};
 useEffect(()=>{
  const controller=new AbortController();setBusy(true);setError('');
  rpc('vcs/file-history',{sessionId,repositoryId,commit,parentIndex,id,offset,limit:50,follow,...date},controller.signal).then(value=>{if(!controller.signal.aborted)setPage(old=>({...value,commits:offset?[...old.commits,...value.commits]:value.commits}));}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[sessionId,repositoryId,commit,parentIndex,id,offset,retry,follow,since,until]);
 return <section aria-label={t('fileHistory')} aria-busy={busy}><p>{t('fileHistoryScope')}</p><p style={{overflowWrap:'anywhere'}}>{page.path} · <code>{commit}</code></p>
 <ol>{page.commits.map(row=><li key={row.id}><code title={row.id}>{row.id.slice(0,10)}</code> · {onSelectCommit?<button onClick={()=>onSelectCommit(row.id,row.path||page.path)}>{row.subject}</button>:row.subject}<div>{row.boundary&&<span>{t(row.boundary==='merge-first-parent'?'fileHistoryMergeBoundary':row.boundary==='ambiguous-rename'?'fileHistoryAmbiguous':row.boundary==='rename-check-limit'?'fileHistoryRenameLimit':'fileHistoryBoundary')} </span>}{row.path&&<code>{row.oldPath?row.oldPath+' → ':''}{row.path}</code>} {row.similarity!==undefined&&<span>{t('fileHistorySimilarity')}: {row.similarity}% · </span>}{row.author} · <time dateTime={row.date}>{row.date}</time></div></li>)}</ol>
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
 const [open,setOpen]=useState(false),[follow,setFollow]=useState(false),[since,setSince]=useState(''),[until,setUntil]=useState('');
 return <div><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{props.t('fileHistory')}</button>{open&&<><label><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/>{props.t('fileHistoryFollow')}</label><p>{props.t('fileHistoryFollowScope')}</p><p>{props.t('fileHistoryDateScope')}</p>{['historyServer_since','historyServer_until'].map((key,index)=><label key={key}>{props.t(key)} <input maxLength={40} placeholder="YYYY-MM-DD[THH:MM[:SS][±HH:MM]]" aria-label={props.t(key)} value={index?until:since} onChange={e=>index?setUntil(e.target.value):setSince(e.target.value)}/></label>)}<FileHistoryPages key={JSON.stringify([follow,since.trim(),until.trim()])} follow={follow} since={since.trim()||null} until={until.trim()||null} {...props}/></>}</div>;
}
