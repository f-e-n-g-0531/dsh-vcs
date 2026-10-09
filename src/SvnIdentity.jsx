import React,{useEffect,useState} from 'react';
export default function SvnIdentity(props){return <Scoped key={JSON.stringify([props.sessionId,props.repositoryId])} {...props}/>;}
function Scoped({sessionId,repositoryId,rpc,t,onRediscover}){
 const [open,setOpen]=useState(false),[data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{if(!open)return;const controller=new AbortController();setData(null);setError('');rpc('vcs/svn-identity',{sessionId,repositoryId},controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});return()=>controller.abort();},[open,sessionId,repositoryId,retry]);
 return <section><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{t('svnIdentity')}</button>{open&&<><p>{t('svnOfflineIdentity')}</p>{error?<p role='alert'>{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>:!data?<p role='status'>{t('loading')}</p>:<><dl>{['origin','root','uuid','scope','revision'].map(key=><React.Fragment key={key}><dt>{key}</dt><dd><code>{data[key]}</code></dd></React.Fragment>)}</dl><p role='status'>{t('svnRemoteDisabled')}</p></>}</>}</section>;
}
