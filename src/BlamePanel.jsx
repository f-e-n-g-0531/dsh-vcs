import React,{useEffect,useState} from 'react';
import HistoricalFile from './HistoricalFile.jsx';
function BlameRows({sessionId,repositoryId,commit,parentIndex,id,rpc,t,onRediscover,onSelectCommit,onSelectLocation,initialOrigin,initialStartLine}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[startLine,setStartLine]=useState(initialStartLine||1),[origin,setOrigin]=useState(initialOrigin?{commit:initialOrigin.commit,path:initialOrigin.path,originalLine:initialOrigin.line,viewer:initialOrigin.viewer}:null);
 useEffect(()=>{
  const controller=new AbortController();setData(null);setError('');
  rpc('vcs/blame',{sessionId,repositoryId,commit,parentIndex,id,startLine,lineLimit:500},controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
  return()=>controller.abort();
 },[sessionId,repositoryId,commit,parentIndex,id,retry,startLine]);
 if(error)return <p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>;
 if(!data)return <p role="status">{t('loading')}</p>;
 return <section aria-label={t('blame')}><p>{t('blameScope')}</p>{onSelectCommit&&<p>{t('blameNavigation')}</p>}
 {data.notice&&<p role="status">{data.notice}</p>}{data.truncated&&<p role="status">{t('blameLimit')}</p>}
 {!data.notice&&!data.lines.length&&<p>{t('blameEmpty')}</p>}
 {!!data.lines.length&&<div style={{overflow:'auto',maxHeight:480}}><table><thead><tr>{['blameLine','blameCommit','blameAuthor','blameSummary','blameSource'].map(key=><th key={key} scope="col">{t(key)}</th>)}</tr></thead><tbody>{data.lines.map(row=><tr key={row.line}><th scope="row">{row.line}</th><td>{onSelectCommit?<button title={row.commit} onClick={()=>onSelectLocation?onSelectLocation(row.commit,row.path||null,{line:row.originalLine||null}):onSelectCommit(row.commit,row.path||null)}><code>{row.commit.slice(0,10)}</code></button>:<code title={row.commit}>{row.commit.slice(0,10)}</code>}</td><td>{row.author}</td><td>{row.summary}</td><td><pre style={{margin:0}}>{row.text}</pre>{row.path&&row.originalLine?<button onClick={()=>setOrigin(row)}>{t('blameOriginLine')}: {row.path}:{row.originalLine}</button>:<span>{t('blameUnmapped')}</span>}</td></tr>)}</tbody></table></div>}
 <p>{data.startLine||startLine}–{data.lines.at(-1)?.line||startLine} / {data.totalLines??'—'}</p><button disabled={startLine===1} onClick={()=>{setOrigin(null);setStartLine(Math.max(1,startLine-500));}}>{t('blamePrevious')}</button><button disabled={data.nextLine==null} onClick={()=>{setOrigin(null);setStartLine(data.nextLine);}}>{t('blameNext')}</button>
 {origin&&<HistoricalFile key={JSON.stringify([origin.commit,origin.path,origin.originalLine])} {...{sessionId,repositoryId,rpc,t,onRediscover}} initialViewer={origin.viewer} onViewerChange={viewer=>setOrigin(old=>old?{...old,viewer}:old)} onSelectCommit={onSelectCommit?(id,path,options={})=>onSelectLocation?onSelectLocation(id,path,{...options,returnLocation:{source:'blame-origin',blameStartLine:startLine,origin:{commit:origin.commit,path:origin.path,line:origin.originalLine,viewer:origin.viewer}}}):onSelectCommit(id,path):undefined} commit={origin.commit} path={origin.path} line={origin.originalLine} onClose={()=>setOrigin(null)}/>}
 </section>;
}
export default function BlamePanel(props){
 const [open,setOpen]=useState(!!props.initialOrigin);
 return <div><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{props.t('blame')}</button>{open&&<BlameRows {...props}/>}</div>;
}
