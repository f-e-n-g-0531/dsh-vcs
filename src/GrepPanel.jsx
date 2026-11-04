import React,{useState,useEffect,useRef} from 'react';
import HistoricalFile from './HistoricalFile.jsx';
import {isPinnedSnapshot} from './preview-actions.mjs';
import {reviewLocation} from './review-location.mjs';

// Scope changes destroy both request ownership and bounded navigation coordinates.
export default function GrepPanel(props){
 return <ScopedGrepPanel key={JSON.stringify([props.sessionId,props.repositoryId])} {...props}/>;
}
function ScopedGrepPanel({sessionId,repositoryId,rpc,t,onRediscover}){
 const [draft,setDraft]=useState(''),[request,setRequest]=useState(null),[result,setResult]=useState(null),[pages,setPages]=useState([]),[selected,setSelected]=useState(null),[trail,setTrail]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const controller=useRef(null);
 const search=(descriptor,previous=[])=>{
  controller.current?.abort();const c=new AbortController();controller.current=c;
  setBusy(true);setError('');setResult(null);setSelected(null);setTrail([]);setRequest(descriptor);setPages(previous);
  rpc('vcs/grep',{sessionId,repositoryId,...descriptor},c.signal).then(value=>{
   if(c.signal.aborted)return;
   // Subsequent requests must never silently follow a moved HEAD.
   if(!isPinnedSnapshot(value?.snapshot)||(descriptor.commit&&descriptor.commit!==value.snapshot)||!Array.isArray(value.matches))throw Error(t('grepInvalid'));
   setResult(value);
  }).catch(e=>{if(c.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();}).finally(()=>{if(!c.signal.aborted)setBusy(false);});
 };
 useEffect(()=>()=>controller.current?.abort(),[]);
 const submit=e=>{e.preventDefault();const query=draft.trim();if(query)search({query});};
 const matches=result?.matches;
 const back=()=>{setSelected(trail.at(-1)||null);setTrail(old=>old.slice(0,-1));};
 const navigate=(commit,path,options={})=>{
  if(!isPinnedSnapshot(commit)||!path)return;
  const viewer=reviewLocation({viewer:options.returnLocation?.viewer||selected?.viewer}).viewer;
  setTrail(old=>[...old,selected&&{...selected,viewer}].filter(Boolean).slice(-100));
  setSelected({commit,path,line:options.line||null,viewer:reviewLocation().viewer});
 };
 const more=()=>{if(busy||!result?.nextCursor)return;search({query:request.query,commit:result.snapshot,cursor:result.nextCursor},[...pages,{...request,commit:result.snapshot}].slice(-100));};
 const previous=()=>{if(!busy&&pages.length)search(pages.at(-1),pages.slice(0,-1));};
 return <section aria-label={t('grepTitle')}><h3>{t('grepTitle')}</h3><p>{t('grepScope')}</p>
  <form onSubmit={submit}><input aria-label={t('grepQuery')} maxLength={1024} placeholder={t('grepPlaceholder')} value={draft} onChange={e=>setDraft(e.target.value)}/><button type="submit" disabled={busy||!draft.trim()}>{t('grepRun')}</button></form>
  {selected?<><button onClick={back}>{t('historyBack')}</button><HistoricalFile key={JSON.stringify([selected.commit,selected.path,selected.line])} {...{sessionId,repositoryId,rpc,t,onRediscover}} commit={selected.commit} path={selected.path} line={selected.line} initialViewer={selected.viewer} onViewerChange={viewer=>setSelected(old=>old?{...old,viewer:reviewLocation({viewer}).viewer}:old)} onClose={back} onSelectCommit={navigate}/></>:<>
   {busy?<p role="status">{t('loading')}</p>:error?<p role="alert">{error} <button onClick={()=>request&&search(request,pages)}>{t('retry')}</button></p>:matches&&<>
    <p role="status">{t('grepPageCount',{count:matches.length})}</p><code>{result.snapshot}</code>
    <p role="status">{t(result.complete===true?'grepComplete':result.nextCursor?'grepMoreAvailable':'grepPartial')}</p>
    {result.reason&&<p role="status">{t('grepReason')}: {t(({"page-limit":'grepPageLimit',"scan-budget":'grepScanBudget',"unsupported-content":'grepUnsupported'})[result.reason]||'grepPartial')}</p>}
    {(result.warnings||[]).map((warning,i)=><p role="status" key={i}>{typeof warning==='string'?warning:warning.message||warning.code}</p>)}
    {!matches.length?<p role="status">{t(result.nextCursor?'grepEmptyPage':'grepEmpty')}</p>:<ol>{matches.map((m,i)=><li key={i}><button onClick={()=>{setTrail([]);setSelected({path:m.path,line:m.line,commit:result.snapshot,viewer:reviewLocation().viewer});}}><code>{m.path}:{m.line}</code></button> <pre style={{margin:0}}>{m.text}</pre>{m.textTruncated&&<span> · {t('grepTextTruncated')}</span>}</li>)}</ol>}
   </>}
   {!!pages.length&&<button disabled={busy} onClick={previous}>{t('grepPreviousPage')}</button>}
   {!error&&result?.nextCursor&&<button disabled={busy} onClick={more}>{t('grepNextPage')}</button>}
  </>}
 </section>;
}
