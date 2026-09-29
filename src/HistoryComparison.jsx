import React,{useEffect,useState} from 'react';
import HistoryViewer from './HistoryViewer.jsx';
import FileHistory from './FileHistory.jsx';
import ImageComparison from './ImageComparison.jsx';
import BlamePanel from './BlamePanel.jsx';
export default function HistoryComparison({sessionId,repositoryId,commit,parentIndex,base,target,id,rpc,t,onRediscover,onSelectCommit}){
 const [comparison,setComparison]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setComparison(null);setError('');
  rpc(base?'vcs/revision-compare':'vcs/commit-compare',base?{sessionId,repositoryId,base,target,id}:{sessionId,repositoryId,commit,parentIndex,id},controller.signal).then(value=>{if(!controller.signal.aborted)setComparison(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
  return()=>controller.abort();
 },[sessionId,repositoryId,commit,parentIndex,base,target,id,retry]);
 if(error)return <p role="alert">{error} <button onClick={()=>setRetry(x=>x+1)}>{t('retry')}</button></p>;
 if(!comparison)return <p role="status">{t('loading')}</p>;
 return <section><h4>{comparison.path}</h4><p>{comparison.left.label} ↔ {comparison.right.label}</p>
 {comparison.notice&&<p role="status">{comparison.notice}</p>}
 {comparison.binary?<p>{t('binary')}</p>:<HistoryViewer comparison={comparison} identity={base?JSON.stringify([sessionId,repositoryId,base,target,id]):JSON.stringify([sessionId,repositoryId,commit,parentIndex,id])} t={t}/>}
 {commit&&!base&&<FileHistory onSelectCommit={onSelectCommit} key={JSON.stringify([sessionId,repositoryId,commit,parentIndex,id])} {...{sessionId,repositoryId,commit,parentIndex,id,rpc,t,onRediscover}}/>}
 {commit&&!base&&<BlamePanel key={JSON.stringify([sessionId,repositoryId,commit,parentIndex,id])} {...{sessionId,repositoryId,commit,parentIndex,id,rpc,t,onRediscover}}/>}
 {commit&&!base&&<ImageComparison key={JSON.stringify([sessionId,repositoryId,commit,parentIndex,id])} {...{sessionId,repositoryId,commit,parentIndex,id,rpc,t,onRediscover}}/>}
 </section>;
}
