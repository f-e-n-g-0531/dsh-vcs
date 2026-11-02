import React,{useState,useEffect,useRef} from 'react';
import HistoricalFile from './HistoricalFile.jsx';
import {filterTreeEntries,treeBreadcrumbs} from './tree-filter.mjs';
function TreeRows({sessionId,repositoryId,commit,rpc,t,onRediscover,onSelectCommit,initialLocation}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[directory,setDirectory]=useState(initialLocation?.directory||''),[offset,setOffset]=useState(initialLocation?.offset||0),[query,setQuery]=useState(initialLocation?.query||''),[selected,setSelected]=useState(initialLocation?.path||null),[legacy,setLegacy]=useState(false),[busy,setBusy]=useState(true);
 const legacyData=useRef(null),selection=useRef(initialLocation?.path||null),viewer=useRef(initialLocation?.viewer);
 const select=path=>{selection.current=path;viewer.current=undefined;setSelected(path);};
 const navigate=(id,path,options={})=>onSelectCommit?.(id,path,{...options,returnLocation:{source:'tree',tree:{directory,offset,query,path:selection.current,viewer:viewer.current}}});
 useEffect(()=>{
  const controller=new AbortController();setBusy(true);setError('');
  const load=async()=>{
   try{return await rpc('vcs/tree-page',{sessionId,repositoryId,commit,path:directory,offset,limit:100,...(query?{query}:{})},controller.signal);}
   catch(e){
    // Old hosts retain their bounded full-tree endpoint. Never hide permission/network failures.
    if(e.code!=='vcs/not-found'&&e.code!=='vcs/unsupported')throw e;
    controller.signal.throwIfAborted();
    const value=await rpc('vcs/tree',{sessionId,repositoryId,commit},controller.signal);
    return {...value,legacy:true};
   }
  };
  const task=legacy?Promise.resolve(legacyData.current):load();
  task.then(value=>{if(!controller.signal.aborted){setData({...value,requestKey:JSON.stringify([directory,offset,query])});if(value.legacy){legacyData.current=value;setLegacy(true);}}}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[sessionId,repositoryId,commit,directory,offset,query,retry,legacy]);
 const go=path=>{setDirectory(path);setOffset(0);setQuery('');select(null);};
 if(error&&!data)return <p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>;
 if(!data)return <p role="status">{t('loading')}</p>;
 const current=data.legacy||data.requestKey===JSON.stringify([directory,offset,query]);
 const prefix=directory?directory+'/':'',all=current?filterTreeEntries(data.entries,directory,query):[],entries=data.legacy?all.slice(offset,offset+100):all;
 const nextOffset=!current?null:data.legacy?(offset+100<all.length?offset+100:null):data.nextOffset;
 return <section aria-label={t('historicalTree')} aria-busy={busy}>
 {busy&&<p role="status">{t('loading')}</p>}{error&&<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>}<p>{t('historicalTreeScope')}</p><code>{commit}</code><p>{directory||'/'} {directory&&<button onClick={()=>go(directory.includes('/')?directory.slice(0,directory.lastIndexOf('/')):'')}>{t('treeUp')}</button>}</p>
 <nav aria-label={t('treeBreadcrumbs')}>{treeBreadcrumbs(directory).map(crumb=><React.Fragment key={crumb.path}>{crumb.path&&' / '}{crumb.path===directory?<span aria-current="location">{crumb.name}</span>:<button onClick={()=>go(crumb.path)}>{crumb.name}</button>}</React.Fragment>)}</nav>
 <label>{t('treeSearch')} <input aria-label={t('treeSearch')} maxLength={1024} value={query} onChange={e=>{setQuery(e.target.value);setOffset(0);select(null);}}/></label>
 <p>{entries.length} {t('treeEntries')}</p>{!busy&&current&&!entries.length&&query&&<p role="status">{t('emptySearch')}</p>}
 <ul>{entries.map(entry=><li key={entry.path}>{entry.type==='tree'?<button onClick={()=>go(entry.path)}>{entry.path.slice(prefix.length)}/</button>:entry.type==='blob'&&['100644','100755'].includes(entry.mode)?<button aria-pressed={selected===entry.path} onClick={()=>select(entry.path)}>{entry.path.slice(prefix.length)}</button>:<span>{entry.path.slice(prefix.length)}</span>} · <code>{entry.mode} {entry.type} <span title={entry.oid}>{entry.oid.slice(0,10)}</span></code></li>)}</ul>
 {data.truncated&&<p role="status">{t('historyLimit')}</p>}
 {offset>0&&<button disabled={busy} onClick={()=>{setOffset(Math.max(0,offset-100));select(null);}}>{t('treePrevious')}</button>}{nextOffset!=null&&<button disabled={busy} onClick={()=>{setOffset(nextOffset);select(null);}}>{t('treeNext')}</button>}
 {selected&&<HistoricalFile key={JSON.stringify([sessionId,repositoryId,commit,selected])} {...{sessionId,repositoryId,commit,rpc,t,onRediscover}} onSelectCommit={onSelectCommit?navigate:undefined} initialViewer={viewer.current} onViewerChange={value=>{viewer.current=value;}} path={selected} onClose={()=>select(null)}/>}
 </section>;
}
export default function HistoricalTree(props){return <ScopedTree key={JSON.stringify([props.sessionId,props.repositoryId,props.commit])} {...props}/>;}
function ScopedTree(props){const [open,setOpen]=useState(!!props.initialLocation);return <div><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{props.t('historicalTree')}</button>{open&&<TreeRows {...props}/>}</div>;}
