import React,{useEffect,useMemo,useState} from 'react';
import HistoryViewer from './HistoryViewer.jsx';
import {validLine,segmentReadingLocation} from './single-file-window.mjs';
export default function HistoricalSegments(props){return <Segments key={JSON.stringify([props.sessionId,props.repositoryId,props.commit,props.path,props.line])} {...props}/>;}
function Segments({sessionId,repositoryId,commit,path,rpc,t,onRediscover,line=null,initialViewer,onViewerChange}){
 const [open,setOpen]=useState(false),[pages,setPages]=useState([validLine(line)?{line}:{offset:0}]),[data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);const page=pages.at(-1);
 useEffect(()=>{if(!open)return;const controller=new AbortController();setData(null);setError('');rpc('vcs/tree-segment',{sessionId,repositoryId,commit,path,...page},controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});return()=>controller.abort();},[open,page,sessionId,repositoryId,commit,path,retry]);
 const comparison=useMemo(()=>data?{path,left:{label:commit,text:data.text},right:{label:commit,text:data.text}}:null,[data,path,commit]);
 // Never substitute segment-local numbers when the server cannot prove global coordinates.
 const {located,startLine,target,partial,emptyLine}=segmentReadingLocation(data,line,Boolean(page.line));
 return <section><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{t('segments')}</button>{open&&<><p>{t('segmentScope')}</p>{error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>{t('retry')}</button></p>:!data?<p role="status">{t('loading')}</p>:<>
 <p>{t('segmentBytes')}: {data.offset}–{data.endOffset} / {data.totalBytes} · <code>{data.oid}</code></p>
 {located&&<p>{t('segmentLines')}: {data.startLine}–{data.endLine}</p>}
 {partial&&<p role="status">{t('segmentPartialLine')}</p>}
 {data.notice&&<p role="status">{data.notice}</p>}
 {validLine(line)&&target===null&&<p role="status">{t('readingTargetMissing')}: {line}</p>}
 <button disabled={pages.length===1} onClick={()=>setPages(v=>v.slice(0,-1))}>{t('previous')}</button>
 <button disabled={!Number.isSafeInteger(data.nextOffset)||data.nextOffset<=data.offset} onClick={()=>setPages(v=>[...v,{offset:data.nextOffset}])}>{t('next')}</button>
 {!located&&<p role="status">{t('segmentLocalCoordinates')}</p>}
 <HistoryViewer key={JSON.stringify([data.oid,data.offset,startLine])} single line={target} startLine={startLine} emptyLine={emptyLine} initialOptions={initialViewer} onOptionsChange={onViewerChange} comparison={comparison} identity={JSON.stringify([sessionId,repositoryId,commit,path,data.offset])} t={t}/>
 </>}</>}</section>;
}
