import React,{useEffect,useState} from 'react';
import HistoryViewer from './HistoryViewer.jsx';
import FileHistory from './FileHistory.jsx';
import ImageComparison from './ImageComparison.jsx';
import BlamePanel from './BlamePanel.jsx';
export default function HistoryComparison(props){
 return <ScopedHistoryComparison key={JSON.stringify([props.sessionId,props.repositoryId,props.commit,props.parentIndex,props.base,props.target,props.id])} {...props}/>;
}
function ScopedHistoryComparison({sessionId,repositoryId,commit,parentIndex,base,target,id,rpc,t,onRediscover,onSelectCommit}){
 const [comparison,setComparison]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[large,setLarge]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();setComparison(null);setError('');
  rpc(base?'vcs/revision-compare':'vcs/commit-compare',base?{sessionId,repositoryId,base,target,id,...(large?{large:true}:{})}:{sessionId,repositoryId,commit,parentIndex,id,...(large?{large:true}:{})},controller.signal).then(value=>{if(!controller.signal.aborted)setComparison(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
  return()=>controller.abort();
 },[sessionId,repositoryId,commit,parentIndex,base,target,id,retry,large]);
 if(error)return <p role="alert">{error} <button onClick={()=>setRetry(x=>x+1)}>{t('retry')}</button>{large&&<button onClick={()=>setLarge(false)}>{t('largeClose')}</button>}</p>;
 if(!comparison)return <p role="status">{t('loading')}{large&&<button onClick={()=>setLarge(false)}>{t('largeClose')}</button>}</p>;
 return <section><h4>{comparison.path}</h4><p>{comparison.left.label} ↔ {comparison.right.label}</p>
 {comparison.notice&&<p role="status">{comparison.notice}</p>}
 {large?<p>{t('largeScope')} <button onClick={()=>setLarge(false)}>{t('largeClose')}</button></p>:comparison.notice?.includes('2 MiB')&&<p>{t('largeScope')} <button onClick={()=>setLarge(true)}>{t('largeLoad')}</button></p>}
 {comparison.binary?<p>{t('binary')}</p>:<HistoryViewer comparison={comparison} identity={base?JSON.stringify([sessionId,repositoryId,base,target,id]):JSON.stringify([sessionId,repositoryId,commit,parentIndex,id])} t={t}/>}
 {commit&&!base&&<FileHistory onSelectCommit={onSelectCommit} key={'file-history:'+JSON.stringify([sessionId,repositoryId,commit,parentIndex,id])} {...{sessionId,repositoryId,commit,parentIndex,id,rpc,t,onRediscover}}/>}
 {commit&&!base&&<BlamePanel onSelectCommit={onSelectCommit} key={'blame:'+JSON.stringify([sessionId,repositoryId,commit,parentIndex,id])} {...{sessionId,repositoryId,commit,parentIndex,id,rpc,t,onRediscover}}/>}
 {(commit||base)&&<ImageComparison key={'image:'+JSON.stringify([sessionId,repositoryId,commit,parentIndex,base,target,id])} {...{sessionId,repositoryId,commit,parentIndex,base,target,id,rpc,t,onRediscover}}/>}
 </section>;
}
