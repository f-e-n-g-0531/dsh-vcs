import React,{useEffect,useState} from 'react';
function BlameRows({sessionId,repositoryId,commit,parentIndex,id,rpc,t,onRediscover,onSelectCommit}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{
  const controller=new AbortController();setData(null);setError('');
  rpc('vcs/blame',{sessionId,repositoryId,commit,parentIndex,id},controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
  return()=>controller.abort();
 },[sessionId,repositoryId,commit,parentIndex,id,retry]);
 if(error)return <p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>;
 if(!data)return <p role="status">{t('loading')}</p>;
 return <section aria-label={t('blame')}><p>{t('blameScope')}</p>
 {data.notice&&<p role="status">{data.notice}</p>}{data.truncated&&<p role="status">{t('blameLimit')}</p>}
 {!data.notice&&!data.lines.length&&<p>{t('blameEmpty')}</p>}
 {!!data.lines.length&&<div style={{overflow:'auto',maxHeight:480}}><table><thead><tr>{['blameLine','blameCommit','blameAuthor','blameSummary','blameSource'].map(key=><th key={key} scope="col">{t(key)}</th>)}</tr></thead><tbody>{data.lines.map(row=><tr key={row.line}><th scope="row">{row.line}</th><td>{onSelectCommit?<button title={row.commit} onClick={()=>onSelectCommit(row.commit)}><code>{row.commit.slice(0,10)}</code></button>:<code title={row.commit}>{row.commit.slice(0,10)}</code>}</td><td>{row.author}</td><td>{row.summary}</td><td><pre style={{margin:0}}>{row.text}</pre></td></tr>)}</tbody></table></div>}
 </section>;
}
export default function BlamePanel(props){
 const [open,setOpen]=useState(false);
 return <div><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{props.t('blame')}</button>{open&&<BlameRows {...props}/>}</div>;
}
