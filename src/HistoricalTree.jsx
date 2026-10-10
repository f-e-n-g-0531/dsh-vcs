import React,{useState,useEffect} from 'react';
import HistoricalFile from './HistoricalFile.jsx';
import {filterTreeEntries,treeBreadcrumbs} from './tree-filter.mjs';
function TreeRows({sessionId,repositoryId,commit,rpc,t,onRediscover,onSelectCommit}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[directory,setDirectory]=useState(''),[page,setPage]=useState(0),[query,setQuery]=useState(''),[selected,setSelected]=useState(null);
 useEffect(()=>{
  const controller=new AbortController();setData(null);setError('');
  rpc('vcs/tree',{sessionId,repositoryId,commit},controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
  return()=>controller.abort();
 },[sessionId,repositoryId,commit,retry]);
 if(error)return <p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>;
 if(!data)return <p role="status">{t('loading')}</p>;
 const prefix=directory?directory+'/':'',entries=filterTreeEntries(data.entries,directory,query);
 const go=path=>{setDirectory(path);setPage(0);setQuery('');setSelected(null);};
 return <section aria-label={t('historicalTree')}><p>{t('historicalTreeScope')}</p><code>{commit}</code><p>{directory||'/'} {directory&&<button onClick={()=>go(directory.includes('/')?directory.slice(0,directory.lastIndexOf('/')):'')}>{t('treeUp')}</button>}</p>
 <nav aria-label={t('treeBreadcrumbs')}>{treeBreadcrumbs(directory).map(crumb=><React.Fragment key={crumb.path}>{crumb.path&&' / '}{crumb.path===directory?<span aria-current="location">{crumb.name}</span>:<button onClick={()=>go(crumb.path)}>{crumb.name}</button>}</React.Fragment>)}</nav>
 <label>{t('treeSearch')} <input aria-label={t('treeSearch')} value={query} onChange={e=>{setQuery(e.target.value);setPage(0);setSelected(null);}}/></label>
 <p>{entries.length} {t('treeEntries')}</p>{!entries.length&&query&&<p role="status">{t('emptySearch')}</p>}
 <ul>{entries.slice(page*100,page*100+100).map(entry=><li key={entry.path}>{entry.type==='tree'?<button onClick={()=>go(entry.path)}>{entry.path.slice(prefix.length)}/</button>:entry.type==='blob'&&['100644','100755'].includes(entry.mode)?<button aria-pressed={selected===entry.path} onClick={()=>setSelected(entry.path)}>{entry.path.slice(prefix.length)}</button>:<span>{entry.path.slice(prefix.length)}</span>} · <code>{entry.mode} {entry.type} <span title={entry.oid}>{entry.oid.slice(0,10)}</span></code></li>)}</ul>
 {page>0&&<button onClick={()=>{setPage(n=>n-1);setSelected(null);}}>{t('treePrevious')}</button>}{(page+1)*100<entries.length&&<button onClick={()=>{setPage(n=>n+1);setSelected(null);}}>{t('treeNext')}</button>}
 {selected&&<HistoricalFile key={JSON.stringify([sessionId,repositoryId,commit,selected])} {...{sessionId,repositoryId,commit,rpc,t,onRediscover,onSelectCommit}} path={selected} onClose={()=>setSelected(null)}/>}
 </section>;
}
export default function HistoricalTree(props){return <ScopedTree key={JSON.stringify([props.sessionId,props.repositoryId,props.commit])} {...props}/>;}
function ScopedTree(props){const [open,setOpen]=useState(false);return <div><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{props.t('historicalTree')}</button>{open&&<TreeRows {...props}/>}</div>;}
