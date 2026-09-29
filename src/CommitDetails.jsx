import React,{useState,useEffect} from 'react';
export default function CommitDetails({sessionId,repositoryId,commit,rpc,t,onRediscover}){
 const [parentIndex,setParentIndex]=useState(0),[details,setDetails]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setDetails(null);setError('');
  rpc('vcs/commit',{sessionId,repositoryId,commit,parentIndex},controller.signal).then(value=>{if(!controller.signal.aborted)setDetails(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
  return()=>controller.abort();
 },[sessionId,repositoryId,commit,parentIndex,retry]);
 if(error)return <p role="alert">{error} <button onClick={()=>setRetry(x=>x+1)}>{t('retry')}</button></p>;
 if(!details)return <p role="status">{t('loading')}</p>;
 return <section aria-label={t('commitDetails')}><h3>{details.subject}</h3><code>{details.id}</code>
 <p>{details.author} · {details.date}</p>
 {details.parents.length>1&&<label>{t('commitParent')} <select value={parentIndex} onChange={e=>{setDetails(null);setParentIndex(Number(e.target.value));}}>{details.parents.map((id,index)=><option key={id} value={index}>{index+1}: {id.slice(0,10)}</option>)}</select></label>}
 <p>{details.parent||t('commitRoot')} → {details.id.slice(0,10)}</p>
 <ul>{details.changes.map(file=><li key={file.id}>{file.status} · {file.oldPath?file.oldPath+' → ':''}{file.path}</li>)}</ul>
 {!details.changes.length&&<p>{t('commitNoChanges')}</p>}
 </section>;
}
