import React,{useState,useEffect} from 'react';
import HistoryViewer from './HistoryViewer.jsx';
// Index stages are identities; numbering avoids asserting merge/rebase ownership.
export default function ConflictStages({sessionId,repositoryId,mode,id,rpc,t,onRediscover}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[left,setLeft]=useState(1),[right,setRight]=useState(3);
 useEffect(()=>{
  const controller=new AbortController();setData(null);setError('');
  rpc('vcs/conflict-stages',{sessionId,repositoryId,mode,id},controller.signal).then(value=>{if(!controller.signal.aborted)setData(value);}).catch(e=>{if(controller.signal.aborted)return;setError(e.message);if(e.code==='vcs/rediscover-required')onRediscover();});
  return()=>controller.abort();
 },[sessionId,repositoryId,mode,id,retry]);
 if(error)return <section aria-label={t('conflictStages')}><h4>{t('conflictStages')}</h4><p role="alert">{error} <button onClick={()=>setRetry(x=>x+1)}>{t('retry')}</button></p></section>;
 if(!data)return <section aria-label={t('conflictStages')}><h4>{t('conflictStages')}</h4><p role="status">{t('loading')}</p></section>;
 const names={1:t('conflictStage1'),2:t('conflictStage2'),3:t('conflictStage3')};
 const at=stage=>data.stages.find(row=>row.stage===stage);
 const side=stage=>{const row=at(stage);return row&&row.present?{text:row.text,label:names[stage]}:{text:'',label:names[stage]};};
 const both=[left,right].every(stage=>at(stage)?.present),comparison={path:data.path,left:side(left),right:side(right),notice:both?'':t('conflictStageMissing')};
 return <section aria-label={t('conflictStages')}><h4>{t('conflictStages')}</h4><p>{t('conflictStagesScope')}</p>
 <ul>{[1,2,3].map(stage=><li key={stage}><code>{names[stage]}</code> · {at(stage)?.present?t('conflictStagePresent'):t('conflictStageAbsent')}{at(stage)?.kind==='gitlink'&&' · '+t('conflictStageGitlink')}{at(stage)?.kind==='symlink'&&' · '+t('conflictStageSymlink')}</li>)}</ul>
 <label>{t('conflictStageLeft')} <select aria-label={t('conflictStageLeft')} value={left} onChange={e=>setLeft(Number(e.target.value))}>{[1,2,3].map(stage=><option key={stage} value={stage}>{names[stage]}</option>)}</select></label>
 <label>{t('conflictStageRight')} <select aria-label={t('conflictStageRight')} value={right} onChange={e=>setRight(Number(e.target.value))}>{[1,2,3].map(stage=><option key={stage} value={stage}>{names[stage]}</option>)}</select></label>
 {comparison.notice&&<p role="status">{comparison.notice}</p>}
 <HistoryViewer key={JSON.stringify([id,left,right,data.snapshot])} comparison={comparison} identity={JSON.stringify([sessionId,repositoryId,mode,id,left,right,data.snapshot])} t={t}/>
 </section>;
}
