import React,{useState,useEffect,useMemo} from 'react';
import {indexHistoryReferences} from './history-refs.mjs';
import CommitDetails from './CommitDetails.jsx';
import HistoryGraph from './HistoryGraph.jsx';
import RevisionPanel from './RevisionPanel.jsx';
import {filterLoadedCommits} from './history-filter.mjs';
export default function HistoryPanel(props){
 return <ScopedHistoryPanel key={JSON.stringify([props.sessionId,props.repositoryId])} {...props}/>;
}
function ScopedHistoryPanel({sessionId,repositoryId,rpc,t,onRediscover}){
 const [selection,setSelection]=useState({id:null,path:null,revision:0}),[query,setQuery]=useState('');
 const [references,setReferences]=useState(null);
 const [draft,setDraft]=useState({message:'',author:'',path:''}),[search,setSearch]=useState(null);
 const submitSearch=value=>{setSearch({values:value,snapshot:page.snapshot});setOffset(0);setQuery('');setSelected(null);setPage(old=>({...old,commits:[],nextOffset:null}));};
 const referenceIndex=useMemo(()=>indexHistoryReferences(references||[]),[references]);
 const selected=selection.id;
 const navigateCommit=(id,path=null)=>setSelection(old=>({id,path,revision:old.revision+1}));
 const setSelected=(id,path=null)=>setSelection(old=>({id,path,revision:old.revision+(path||old.path?1:0)}));
 const [page,setPage]=useState({commits:[],snapshot:null,nextOffset:null}),[offset,setOffset]=useState(0),[retry,setRetry]=useState(0),[busy,setBusy]=useState(true),[error,setError]=useState('');
 // Scope changes remount locally; parent still remounts for refresh. Pagination pins first snapshot.
 useEffect(()=>{
  const controller=new AbortController();setBusy(true);setError('');
  rpc('vcs/history',{sessionId,repositoryId,offset,limit:50,...(search?{search:search.values}:{}),...((search?.snapshot||offset)?{snapshot:search?.snapshot||page.snapshot}:{})},controller.signal).then(value=>{
   if(!controller.signal.aborted)setPage(old=>({...value,commits:offset?[...old.commits,...value.commits]:value.commits}));
  }).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[sessionId,repositoryId,offset,retry,search]);
 const commits=filterLoadedCommits(page.commits,query);
 return <section className="vcs-history" aria-label={t('history')} aria-busy={busy}>
 <div className="vcs-history-list"><p>{t('historyListOnly')}</p>{references!==null&&<p>{t('historyRefsScope')}</p>}
 <form aria-label={t('historyServerSearch')} onSubmit={e=>{e.preventDefault();submitSearch({...draft});}}><fieldset disabled={busy}><legend>{t('historyServerSearch')}</legend><p>{t('historyServerScope')}</p>{['message','author','path'].map(field=><label key={field}>{t('historyServer_'+field)} <input maxLength={1024} aria-label={t('historyServer_'+field)} value={draft[field]} onChange={e=>setDraft(old=>({...old,[field]:e.target.value}))}/></label>)}<button type="submit">{t('historyServerApply')}</button><button type="button" onClick={()=>{setDraft({message:'',author:'',path:''});submitSearch({});}}>{t('historyServerClear')}</button></fieldset></form>
 {search&&<p role="status">{t('historyServerActive')}: {JSON.stringify(search.values)} · <code>{search.snapshot||page.snapshot}</code></p>}
 <label>{t('historySearch')} <input aria-label={t('historySearch')} value={query} onChange={e=>{setQuery(e.target.value);setSelected(null);}}/></label><span> {commits.length} / {page.commits.length}</span>
 {!!page.commits.length&&!commits.length&&<p role="status">{t('historyNoMatch')}</p>}
 <ol>{commits.map(commit=><li key={commit.id}><button aria-pressed={selected===commit.id} onClick={()=>setSelected(commit.id)}>{commit.subject}</button><div><code title={commit.id}>{commit.id.slice(0,10)}</code> · {commit.author} · <time dateTime={commit.date}>{commit.date}</time></div>{referenceIndex.has(commit.id)&&<div aria-label={t('historyRefsLabel')} style={{overflowWrap:'anywhere'}}>{referenceIndex.get(commit.id).names.map(name=><span key={name}><code>{name}</code>{' '}</span>)}{referenceIndex.get(commit.id).hidden>0&&<span>{t('historyRefsMore')}: {referenceIndex.get(commit.id).hidden}</span>}</div>}</li>)}</ol>
 {busy&&<p role="status">{t('loading')}</p>}
 {error&&<p role="alert">{error} <button onClick={()=>setRetry(x=>x+1)}>{t('retry')}</button></p>}
 {!busy&&!error&&!page.commits.length&&<p>{t('historyEmpty')}</p>}
 {page.truncated&&<p role="status">{t('historyLimit')}</p>}
 {!error&&page.nextOffset!==null&&<button disabled={busy} onClick={()=>setOffset(page.nextOffset)}>{t('historyMore')}</button>}
 {!!page.commits.length&&<HistoryGraph commits={page.commits} selected={selected} onSelect={setSelected} t={t}/>}
 <RevisionPanel onReferencesLoaded={setReferences} commits={page.commits} {...{sessionId,repositoryId,rpc,t,onRediscover}}/>
 </div><div className="vcs-history-details">{selected&&<CommitDetails key={JSON.stringify([selected,selection.revision])} initialPath={selection.path} sessionId={sessionId} repositoryId={repositoryId} commit={selected} onSelectCommit={navigateCommit} rpc={rpc} t={t} onRediscover={onRediscover}/>}
 </div></section>;
}
