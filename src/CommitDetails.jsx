import React,{useState,useEffect,useRef} from 'react';
import HistoricalTree from './HistoricalTree.jsx';
import HistoricalFile from './HistoricalFile.jsx';
import {reviewLocation} from './review-location.mjs';
import HistoryComparison from './HistoryComparison.jsx';
import {filterCommitFiles,selectExactHistoryPath} from './history-filter.mjs';
export default function CommitDetails(props){
 return <ScopedCommitDetails key={JSON.stringify([props.sessionId,props.repositoryId,props.commit])} {...props}/>;
}
function ScopedCommitDetails({sessionId,repositoryId,commit,rpc,t,onRediscover,onSelectCommit,initialPath,initialLocation,onLocationChange}){
 const navigationPending=useRef(true);
 const initial=reviewLocation({...initialLocation,path:initialPath||initialLocation?.path});
 const report=patch=>onLocationChange?.(patch);
 const navigate=(id,path,options={})=>onSelectCommit?.(id,path,{returnLocation:{source:'comparison',origin:null},...options});
 const [selected,setSelected]=useState(null),[query,setQuery]=useState(initial.fileQuery),[focused,setFocused]=useState(initial.focused),[line,setLine]=useState(initial.line);
 const [parentIndex,setParentIndex]=useState(initial.parentIndex),[details,setDetails]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setDetails(null);setError('');
  rpc('vcs/commit',{sessionId,repositoryId,commit,parentIndex},controller.signal).then(value=>{if(!controller.signal.aborted){setDetails(value);if(navigationPending.current){navigationPending.current=false;setSelected(selectExactHistoryPath(value.changes,initial.path));}}}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
  return()=>controller.abort();
 },[sessionId,repositoryId,commit,parentIndex,retry]);
 if(error)return <p role="alert">{error} <button onClick={()=>setRetry(x=>x+1)}>{t('retry')}</button></p>;
 if(!details)return <p role="status">{t('loading')}</p>;
 const files=filterCommitFiles(details.changes,query);
 return <section className={'vcs-commit-details'+(focused?' vcs-commit-focused':'')} aria-label={t('commitDetails')}><div className="vcs-commit-sidebar"><header className="vcs-commit-summary"><h3>{details.subject}</h3><code className="vcs-commit-oid">{details.id}</code>
 <p>{details.author} · {details.date}</p>
 {details.committer&&details.committer!==details.author&&<p>{t('commitCommitter')} {details.committer}{details.committerDate?` · ${details.committerDate}`:''}</p>}
 {details.signature?.signed===true&&<p><span title={t('commitSignatureUnverified')}>{t('commitSigned',{format:details.signature.format})}</span></p>}
 {details.messageTruncated&&<p role="status">{t('commitMessageLimit')}</p>}
 {details.message&&<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:240,overflow:'auto'}}>{details.message}</pre>}
 {details.parents.length>1&&<label>{t('commitParent')} <select aria-label={t('commitParent')} value={parentIndex} onChange={e=>{setSelected(null);setDetails(null);setLine(null);setParentIndex(Number(e.target.value));report({source:'comparison',origin:null,parentIndex:Number(e.target.value),path:null,line:null});}}>{details.parents.map((id,index)=><option key={id} value={index}>{index+1}: {id.slice(0,10)}</option>)}</select></label>}
 <p>{details.parent||t('commitRoot')} → {details.id.slice(0,10)}</p>
 </header><aside className="vcs-commit-picker"><label>{t('commitFileSearch')} <input aria-label={t('commitFileSearch')} value={query} onChange={e=>{setQuery(e.target.value);setSelected(null);setLine(null);report({fileQuery:e.target.value,path:null,line:null});}}/></label><span> {files.length} / {details.changes.length}</span>
 <ul className="vcs-commit-files">{files.map(file=><li key={file.id}><button aria-pressed={selected===file.id} onClick={()=>{setSelected(file.id);setLine(null);report({source:'comparison',origin:null,path:file.path,line:null});}}><span className="vcs-file-status">{file.status} · </span><span className="vcs-file-path" title={file.oldPath?file.oldPath+' → '+file.path:file.path}>{file.path}{file.oldPath&&<small>← {file.oldPath}</small>}</span></button></li>)}</ul>
 {!!details.changes.length&&!files.length&&<p role="status">{t('emptySearch')}</p>}
 {!details.changes.length&&<p>{t('commitNoChanges')}</p>}
 <HistoricalTree key={JSON.stringify([sessionId,repositoryId,commit])} initialLocation={initial.source==='tree'?initial.tree:null} {...{sessionId,repositoryId,commit,rpc,t,onRediscover,onSelectCommit}}/>
 </aside></div><div className="vcs-commit-review"><div className="vcs-commit-comparison" aria-label={t('comparisonContext')}>
 {selected&&<button className="vcs-comparison-focus" aria-pressed={focused} onClick={()=>{setFocused(!focused);report({focused:!focused});}}>{t(focused?'comparisonRestore':'comparisonFocus')}</button>}
 {line&&initial.path?<HistoricalFile {...{sessionId,repositoryId,commit,rpc,t,onRediscover}} onSelectCommit={onSelectCommit?navigate:undefined} path={initial.path} line={line} initialViewer={initial.viewer} onViewerChange={viewer=>report({viewer})} onClose={()=>{setLine(null);report({line:null});}}/>:selected?<HistoryComparison key={selected} sessionId={sessionId} repositoryId={repositoryId} commit={commit} parentIndex={parentIndex} id={selected} initialViewer={initial.viewer} initialOrigin={initial.source==='blame-origin'?initial.origin:null} initialBlameStartLine={initial.blameStartLine} onViewerChange={viewer=>report({viewer})} onSelectCommit={onSelectCommit?navigate:undefined} rpc={rpc} t={t} onRediscover={onRediscover}/>:<p role="status">{t('pick')}</p>}
 </div></div></section>;
}
