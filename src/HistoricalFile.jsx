import React,{useEffect,useState,useMemo} from 'react';
import HistoryViewer from './HistoryViewer.jsx';
export default function HistoricalFile({sessionId,repositoryId,commit,path,rpc,t,onRediscover,onClose}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setData(null);setError('');
 rpc('vcs/tree-file',{sessionId,repositoryId,commit,path},controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
 return()=>controller.abort();},[sessionId,repositoryId,commit,path,retry]);
 const preview=useMemo(()=>data?{path,left:{label:commit,text:data.text||''},right:{label:commit,text:data.text||''}}:null,[data,path,commit]);
 return <section aria-label={t('treePreview')}><h4>{path}</h4><button onClick={onClose}>{t('treeClose')}</button><p><code>{commit}</code></p>
 {error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>:!data?<p role="status">{t('loading')}</p>:<><p><code>{data.oid}</code> · {t('encoding')}: {data.encoding||'—'}</p>{data.notice&&<p role="status">{data.notice}</p>}{data.binary?<p>{t('binary')}</p>:data.text===''?<p>{t('treeEmpty')}</p>:<HistoryViewer single comparison={preview} identity={JSON.stringify([sessionId,repositoryId,commit,path])} t={t}/>}</>}
 </section>;
}
