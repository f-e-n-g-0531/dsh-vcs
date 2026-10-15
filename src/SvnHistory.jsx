import React,{useEffect,useState} from 'react';
import HistoryViewer from './HistoryViewer.jsx';
import {filterSvnHistory} from './svn-history-filter.mjs';
import {mergeSvnHistoryWindow} from './svn-history-window.mjs';
import {previousSvnRevision} from './svn-revision.mjs';
// Network authority remains the approved token, fixed snapshot and opaque member ID.
export default function SvnHistory(props){return <Scoped key={JSON.stringify([props.sessionId,props.repositoryId,props.token,props.snapshot])} {...props}/>;}
function Scoped({sessionId,repositoryId,token,snapshot,rpc,t,onRediscover}){
 const [position,setPosition]=useState({cursor:snapshot,offset:0,trail:[]});
 const [page,setPage]=useState(null),[selected,setSelected]=useState(null),[busy,setBusy]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0),[since,setSince]=useState(''),[until,setUntil]=useState('');
 const {cursor,offset}=position;
 useEffect(()=>{
  const c=new AbortController();setBusy(true);setError('');
  rpc('vcs/svn-log',{sessionId,repositoryId,token,snapshot,cursor,limit:50},c.signal).then(value=>{
   if(!c.signal.aborted){setPage(old=>mergeSvnHistoryWindow(old,value,offset));if(offset>=200)setSelected(null);}
  }).catch(e=>{if(!c.signal.aborted){setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();}}).finally(()=>{if(!c.signal.aborted)setBusy(false);});
  return()=>c.abort();
 },[cursor,offset,retry]);
 const more=()=>setPosition(old=>({cursor:page.nextRevision,offset:page.windowEnd,trail:[...old.trail,{cursor,offset}].slice(-200)}));
 const back=()=>{const previous=position.trail.at(-1);if(!previous)return;setSelected(null);setPage(null);setPosition({...previous,trail:position.trail.slice(0,-1)});};
 let visible=page?.entries||[],dateError='';try{visible=filterSvnHistory(visible,{since,until});}catch(e){dateError=e.message;}
 return <section className="vcs-history vcs-history-browser vcs-svn-history" aria-label={t('history')} aria-busy={busy}>
  <div className="vcs-history-list"><p>{t('svnHistoryScope')} · r{snapshot}</p>
   <details className="vcs-help"><summary>{t('historySearchHelp')}</summary><p>{t('svnHistoryDateScope')}</p>{['historyServer_since','historyServer_until'].map((key,index)=><label key={key}>{t(key)} <input maxLength={40} placeholder="YYYY-MM-DD" aria-label={t(key)} value={index?until:since} onChange={e=>{setSelected(null);index?setUntil(e.target.value):setSince(e.target.value);}}/></label>)}</details>
   {dateError&&<p role="alert">{dateError}</p>}
   {!!page?.entries.length&&<p role="status">{t('historyWindow')}: {page.windowEnd-page.entries.length}–{page.windowEnd}</p>}
   <ol className="vcs-commit-list">{visible.map(entry=><li key={entry.revision}><button className="vcs-commit-row" aria-pressed={selected===entry.revision} onClick={()=>setSelected(entry.revision)}><span className="vcs-commit-subject">r{entry.revision} · {entry.message.split(/\r?\n/)[0]}</span></button><div className="vcs-commit-meta"><code>r{entry.revision}</code> · {entry.author} · <time dateTime={entry.date}>{entry.date}</time></div></li>)}</ol>
   {busy&&<p role="status">{t('loading')}</p>}
   {error&&<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>}
   {!busy&&!error&&!page?.entries.length&&<p>{t('historyEmpty')}</p>}
   {!!page?.entries.length&&!visible.length&&<p role="status">{t('historyNoMatch')}</p>}
   {!!position.trail.length&&<button disabled={busy} onClick={back}>{t('historyBack')}</button>}
   {!error&&page?.nextRevision!=null&&<button disabled={busy} onClick={more}>{t('historyMore')}</button>}
  </div><div className="vcs-history-details">{selected&&<Detail key={selected} {...{sessionId,repositoryId,token,snapshot,rpc,t,onRediscover}} revision={selected}/>}</div>
 </section>;
}
function Detail({sessionId,repositoryId,token,snapshot,revision,rpc,t,onRediscover}){
 const [data,setData]=useState(null),[selection,setSelection]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[query,setQuery]=useState(''),[focused,setFocused]=useState(false);
 useEffect(()=>{const c=new AbortController();setData(null);setSelection(null);setError('');rpc('vcs/svn-detail',{sessionId,repositoryId,token,snapshot,revision},c.signal).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted){setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();}});return()=>c.abort();},[retry]);
 const files=(data?.changes||[]).filter(change=>change.path.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
 return <section className={'vcs-commit-details'+(focused?' vcs-commit-focused':'')} aria-label={t('commitDetails')}>
  {error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>:!data?<p role="status">{t('loading')}</p>:<div className="vcs-commit-sidebar">
   <header className="vcs-commit-summary"><h3>{data.message?.split(/\r?\n/)[0]||'r'+revision}</h3><code className="vcs-commit-oid">r{revision}</code><p>{data.author} · {data.date}</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{data.message}</pre><p>{previousSvnRevision(revision)===null?t('commitRoot'):'r'+previousSvnRevision(revision)} → r{revision}</p></header>
   <aside className="vcs-commit-picker"><label>{t('commitFileSearch')} <input aria-label={t('commitFileSearch')} value={query} onChange={e=>{setQuery(e.target.value);setSelection(null);}}/></label><span>{files.length} / {data.changes.length}</span>
    <ul className="vcs-commit-files">{files.map(change=><li key={change.id}><button disabled={change.kind!=='file'} aria-pressed={selection?.id===change.id&&selection.mode==='compare'} onClick={()=>setSelection({id:change.id,mode:'compare'})}><span className="vcs-file-status">{change.action} · </span><span className="vcs-file-path" title={change.path}>{change.path}{change.copyFromPath&&<small>← {change.copyFromPath} @r{change.copyFromRevision}</small>}</span></button>
     {change.kind==='file'&&<div className="vcs-svn-file-actions"><button onClick={()=>setSelection({id:change.id,mode:'trace'})}>{t('fileHistory')}</button>{change.copyFromPath&&change.copyFromRevision&&!change.copySourceOutsideScope&&<button onClick={()=>setSelection({id:change.id,mode:'copytrace'})}>{t('svnCopyHistory')} · {change.copyFromPath} @r{change.copyFromRevision}</button>}{change.copySourceOutsideScope&&<span>{t('svnCopyOutside')}</span>}</div>}
    </li>)}</ul>
    {!!data.changes.length&&!files.length&&<p role="status">{t('emptySearch')}</p>}{!data.changes.length&&<p>{t('commitNoChanges')}</p>}
   </aside>
  </div>}
  <div className="vcs-commit-review"><div className="vcs-commit-comparison" aria-label={t('comparisonContext')}>
   {selection&&<button className="vcs-comparison-focus" aria-pressed={focused} onClick={()=>setFocused(v=>!v)}>{t(focused?'comparisonRestore':'comparisonFocus')}</button>}
   {selection?<Selected key={JSON.stringify(selection)} {...{sessionId,repositoryId,token,snapshot,revision,rpc,t,onRediscover}} {...selection}/>:<p role="status">{t('pick')}</p>}
  </div></div>
 </section>;
}
function Selected({sessionId,repositoryId,token,snapshot,revision,rpc,t,onRediscover,id,mode}){
 const [data,setData]=useState(null),[cursor,setCursor]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const c=new AbortController();setData(null);setError('');rpc('vcs/svn-'+mode,{sessionId,repositoryId,token,snapshot,revision,id,...(cursor===null?{}:{cursor})},c.signal).then(v=>{if(!c.signal.aborted)setData(v);}).catch(e=>{if(!c.signal.aborted){setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();}});return()=>c.abort();},[cursor,retry]);
 return error?<p role='alert'>{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>:!data?<p role='status'>{t('loading')}</p>:mode==='compare'?<section className="vcs-history-comparison"><header className="vcs-comparison-heading"><h4>{data.path}</h4><p>{data.left?.label} ↔ {data.right?.label}</p>{data.notice&&<p role="status">{data.notice}</p>}</header>{data.binary?<p>{t('binary')}</p>:<HistoryViewer comparison={data} identity={JSON.stringify([sessionId,repositoryId,snapshot,revision,id])} t={t}/>}</section>:<section><p>{t(mode==='copytrace'?'svnCopyTraceScope':'svnTraceScope')} · {data.path} · peg r{data.pegRevision}</p><ol>{data.entries.map(e=><li key={e.revision}>r{e.revision} · {e.message}</li>)}</ol>{data.nextRevision!==null&&<button onClick={()=>setCursor(data.nextRevision)}>{t('historyMore')}</button>}</section>;
}
