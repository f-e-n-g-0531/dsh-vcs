import React,{useEffect,useState} from 'react';
import TextComparison from './TextComparison.jsx';
export default function HistoryComparison({sessionId,repositoryId,commit,parentIndex,id,rpc,t,onRediscover}){
 const [comparison,setComparison]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setComparison(null);setError('');
  rpc('vcs/commit-compare',{sessionId,repositoryId,commit,parentIndex,id},controller.signal).then(value=>{if(!controller.signal.aborted)setComparison(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
  return()=>controller.abort();
 },[sessionId,repositoryId,commit,parentIndex,id,retry]);
 if(error)return <p role="alert">{error} <button onClick={()=>setRetry(x=>x+1)}>{t('retry')}</button></p>;
 if(!comparison)return <p role="status">{t('loading')}</p>;
 return <section><h4>{comparison.path}</h4><p>{comparison.left.label} ↔ {comparison.right.label}</p>
 {comparison.notice&&<p role="status">{comparison.notice}</p>}
 {comparison.binary?<p>{t('binary')}</p>:<div style={{position:'relative',height:360}}><TextComparison comparison={comparison} labels={{approximate:t('approximate'),truncated:t('textTruncated')}}/></div>}
 </section>;
}
