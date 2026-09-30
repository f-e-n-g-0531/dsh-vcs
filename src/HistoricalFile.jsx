import React,{useEffect,useState} from 'react';
export default function HistoricalFile({sessionId,repositoryId,commit,path,rpc,t,onRediscover,onClose}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{const controller=new AbortController();setData(null);setError('');
 rpc('vcs/tree-file',{sessionId,repositoryId,commit,path},controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
 return()=>controller.abort();},[sessionId,repositoryId,commit,path,retry]);
 return <section aria-label={t('treePreview')}><h4>{path}</h4><button onClick={onClose}>{t('treeClose')}</button><p><code>{commit}</code></p>
 {error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>:!data?<p role="status">{t('loading')}</p>:<><p><code>{data.oid}</code> · {t('encoding')}: {data.encoding||'—'}</p>{data.notice&&<p role="status">{data.notice}</p>}{data.binary?<p>{t('binary')}</p>:data.text===''?<p>{t('treeEmpty')}</p>:<pre tabIndex={0} style={{maxHeight:480,overflow:'auto',whiteSpace:'pre',tabSize:4}}>{data.text}</pre>}</>}
 </section>;
}
