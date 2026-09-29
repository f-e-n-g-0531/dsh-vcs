import React,{useEffect,useState} from 'react';
import HistoryComparison from './HistoryComparison.jsx';
import {filterCommitFiles} from './history-filter.mjs';
function RevisionFiles({sessionId,repositoryId,base,target,rpc,t,onRediscover}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[selected,setSelected]=useState(null),[query,setQuery]=useState('');
 useEffect(()=>{
  const controller=new AbortController();setData(null);setError('');setSelected(null);
  rpc('vcs/revision-changes',{sessionId,repositoryId,base,target},controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
  return()=>controller.abort();
 },[sessionId,repositoryId,base,target,retry]);
 if(error)return <p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>;
 if(!data)return <p role="status">{t('loading')}</p>;
 const files=filterCommitFiles(data.changes,query);
 return <div><label>{t('commitFileSearch')} <input aria-label={t('commitFileSearch')} value={query} onChange={e=>{setQuery(e.target.value);setSelected(null);}}/></label><span> {files.length} / {data.changes.length}</span>
 {!!data.changes.length&&!files.length&&<p role="status">{t('emptySearch')}</p>}
 {!data.changes.length&&<p>{t('revisionEmpty')}</p>}<ul>{files.map(file=><li key={file.id}><button aria-pressed={selected===file.id} onClick={()=>setSelected(file.id)}>{file.status} · {file.oldPath?file.oldPath+' → ':''}{file.path}</button></li>)}</ul>
 {selected&&<HistoryComparison key={selected} sessionId={sessionId} repositoryId={repositoryId} base={base} target={target} id={selected} rpc={rpc} t={t} onRediscover={onRediscover}/>}</div>;
}
export default function RevisionPanel({commits,sessionId,repositoryId,rpc,t,onRediscover}){
 const [base,setBase]=useState(''),[target,setTarget]=useState('');
 return <section aria-label={t('revisionTitle')}><h3>{t('revisionTitle')}</h3><p>{t('revisionScope')}</p>
 {[[base,setBase,'revisionBase'],[target,setTarget,'revisionTarget']].map(([value,setValue,label])=><label key={label}>{t(label)} <select aria-label={t(label)} value={value} onChange={e=>setValue(e.target.value)}><option value="">—</option>{commits.map(c=><option key={c.id} value={c.id}>{c.id.slice(0,10)} · {c.subject}</option>)}</select></label>)}
 <button disabled={!base||!target} onClick={()=>{setBase(target);setTarget(base);}}>{t('revisionSwap')}</button>
 <p style={{overflowWrap:'anywhere'}}><code>{base||'—'}</code> → <code>{target||'—'}</code></p>
 {base&&target&&<RevisionFiles key={JSON.stringify([sessionId,repositoryId,base,target])} {...{sessionId,repositoryId,base,target,rpc,t,onRediscover}}/>}
 </section>;
}
