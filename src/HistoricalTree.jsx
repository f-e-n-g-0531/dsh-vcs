import React,{useState,useEffect} from 'react';
function TreeRows({sessionId,repositoryId,commit,rpc,t,onRediscover}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[directory,setDirectory]=useState(''),[page,setPage]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setData(null);setError('');
  rpc('vcs/tree',{sessionId,repositoryId,commit},controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
  return()=>controller.abort();
 },[sessionId,repositoryId,commit,retry]);
 if(error)return <p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>;
 if(!data)return <p role="status">{t('loading')}</p>;
 const prefix=directory?directory+'/':'',entries=data.entries.filter(e=>e.path.startsWith(prefix)&&!e.path.slice(prefix.length).includes('/'));
 const go=path=>{setDirectory(path);setPage(0);};
 return <section aria-label={t('historicalTree')}><p>{t('historicalTreeScope')}</p><code>{commit}</code><p>{directory||'/'} {directory&&<button onClick={()=>go(directory.includes('/')?directory.slice(0,directory.lastIndexOf('/')):'')}>{t('treeUp')}</button>}</p>
 <p>{entries.length} {t('treeEntries')}</p>
 <ul>{entries.slice(page*100,page*100+100).map(entry=><li key={entry.path}>{entry.type==='tree'?<button onClick={()=>go(entry.path)}>{entry.path.slice(prefix.length)}/</button>:<span>{entry.path.slice(prefix.length)}</span>} · <code>{entry.mode} {entry.type} <span title={entry.oid}>{entry.oid.slice(0,10)}</span></code></li>)}</ul>
 {page>0&&<button onClick={()=>setPage(n=>n-1)}>{t('treePrevious')}</button>}{(page+1)*100<entries.length&&<button onClick={()=>setPage(n=>n+1)}>{t('treeNext')}</button>}
 </section>;
}
export default function HistoricalTree(props){const [open,setOpen]=useState(false);return <div><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{props.t('historicalTree')}</button>{open&&<TreeRows {...props}/>}</div>;}
