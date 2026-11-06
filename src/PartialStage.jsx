import React,{useEffect,useRef,useState} from 'react';

const hex=value=>typeof value==='string'&&value.length===64&&/^[a-f0-9]{64}$/.test(value);
const oid=value=>typeof value==='string'&&(value.length===40||value.length===64)&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const integer=(value,max)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const entry=value=>value&&oid(value.oid)&&['100644','100755'].includes(value.mode);
const sameEntry=(a,b)=>entry(a)&&entry(b)&&a.oid===b.oid&&a.mode===b.mode;
const validExpiry=value=>Number.isSafeInteger(value)&&value>Date.now()&&value<=Date.now()+61000;
const endings={LF:1,CRLF:2,CR:1,NONE:0};
// Count UTF-8 without allocating an encoded copy of an untrusted string.
function bytes(text){
 if(typeof text!=='string'||text.length>262144)throw Error('invalid');
 let size=0;
 for(let i=0;i<text.length;i++){
  const code=text.charCodeAt(i);
  if(code<32&&code!==9||code===127)throw Error('invalid');
  if(code>=0xd800&&code<=0xdbff){const next=text.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))throw Error('invalid');size+=4;}
  else if(code>=0xdc00&&code<=0xdfff)throw Error('invalid');
  else size+=code<128?1:code<2048?2:3;
  if(size>262144)throw Error('invalid');
 }
 return size;
}
function base(value){
 if(value?.action!=='partial-stage'||typeof value.path!=='string'||!value.path||value.path.length>4096||/[\u0000-\u001f\u007f]/.test(value.path)||!oid(value.head)||!entry(value.index)||value.index.oid.length!==value.head.length||!validExpiry(value.expiresAt))throw Error('invalid');
 return {action:'partial-stage',path:value.path,head:value.head,index:{oid:value.index.oid,mode:value.index.mode},expiresAt:value.expiresAt};
}
export function validatePartialPlan(value){
 const common=base(value),p=value.plan;
 if(!hex(value.planToken)||!p||!hex(p.id)||p.algorithm!=='raw-line-lcs-v1'||!hex(p.beforeHash)||!hex(p.afterHash)||!integer(p.beforeBytes,262144)||!integer(p.afterBytes,262144)||!integer(p.beforeLineCount,4000)||!integer(p.afterLineCount,4000)||!integer(p.lcsCells,200000)||!Array.isArray(p.units)||!p.units.length||p.units.length>4000)throw Error('invalid');
 const seen=new Set(),totals={before:0,after:0},ends={before:0,after:0},units=[];
 for(const unit of p.units){
  if(!unit||!hex(unit.id)||seen.has(unit.id)||!integer(unit.beforeStart,p.beforeLineCount)||!integer(unit.afterStart,p.afterLineCount)||!integer(unit.beforeCount,4000)||!integer(unit.afterCount,4000)||!unit.beforeCount&&!unit.afterCount||unit.beforeStart<ends.before||unit.afterStart<ends.after||unit.beforeStart-ends.before!==unit.afterStart-ends.after)throw Error('invalid');
  seen.add(unit.id);const copy={id:unit.id};
  for(const side of ['before','after']){
   const start=unit[side+'Start'],count=unit[side+'Count'],lines=unit[side],lineCount=p[side+'LineCount'];
   if(start+count>lineCount||!Array.isArray(lines)||lines.length!==count)throw Error('invalid');
   copy[side+'Start']=start;copy[side+'Count']=count;copy[side]=[];
   for(let i=0;i<count;i++){
    const line=lines[i];if(!line||typeof line.terminator!=='string'||line.terminator.length>4||!Object.hasOwn(endings,line.terminator)||line.terminator==='NONE'&&(start+i!==lineCount-1||!line.text))throw Error('invalid');
    totals[side]+=bytes(line.text)+endings[line.terminator];if(totals[side]>p[side+'Bytes'])throw Error('invalid');
    copy[side].push({text:line.text,terminator:line.terminator});
   }
   ends[side]=start+count;
  }
  units.push(copy);
 }
 if(p.beforeLineCount-ends.before!==p.afterLineCount-ends.after)throw Error('invalid');
 return {...common,planToken:value.planToken,plan:{id:p.id,algorithm:p.algorithm,beforeHash:p.beforeHash,afterHash:p.afterHash,beforeBytes:p.beforeBytes,afterBytes:p.afterBytes,beforeLineCount:p.beforeLineCount,afterLineCount:p.afterLineCount,lcsCells:p.lcsCells,units}};
}
function validateCandidate(value,plan,ids){
 const common=base(value);
 if(common.path!==plan.path||common.head!==plan.head||!sameEntry(common.index,plan.index)||!entry(value.target)||value.target.oid.length!==common.head.length||value.target.mode!==common.index.mode||!hex(value.token)||value.planId!==plan.plan.id||!Array.isArray(value.unitIds)||value.unitIds.length!==ids.length||value.unitIds.length>4000)throw Error('invalid');
 const expected=new Set(ids),seen=new Set();for(const id of value.unitIds){if(!hex(id)||!expected.has(id)||seen.has(id))throw Error('invalid');seen.add(id);}
 return {...common,target:{oid:value.target.oid,mode:value.target.mode},planId:value.planId,unitIds:[...ids],token:value.token};
}
const message=(error,fallback)=>typeof error?.message==='string'?error.message.slice(0,1000):fallback;
export default function PartialStage(props){
 return <ScopedPartialStage key={JSON.stringify([props.sessionId,props.repositoryId,props.id,props.refresh,props.mode])} {...props}/>;
}
function ScopedPartialStage({sessionId,repositoryId,id,mode,rpc,t,onStaged,onRediscover,onUnknown,blocked=false,pending=false}){
 const [open,setOpen]=useState(false),[plan,setPlan]=useState(null),[selected,setSelected]=useState([]),[candidate,setCandidate]=useState(null),[checked,setChecked]=useState(false),[consumed,setConsumed]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[unknown,setUnknown]=useState(false);
 const alive=useRef(true),task=useRef(null),locked=useRef(false),uncertain=useRef(false),confirming=useRef(false),currentPlan=useRef(null),currentCandidate=useRef(null),selection=useRef([]),ack=useRef(false),used=useRef(false),block=useRef(blocked);block.current=blocked;
 const clear=()=>{currentPlan.current=null;currentCandidate.current=null;selection.current=[];ack.current=false;used.current=false;setPlan(null);setCandidate(null);setSelected([]);setChecked(false);setConsumed(false);};
 const markUnknown=()=>{confirming.current=false;uncertain.current=true;setUnknown(true);onUnknown?.();};
 useEffect(()=>{alive.current=true;return()=>{if(confirming.current){uncertain.current=true;onUnknown?.();}alive.current=false;currentPlan.current=null;currentCandidate.current=null;ack.current=false;task.current?.abort();};},[]);
 // A consumed plan may expire without invalidating its separately expiring candidate.
 useEffect(()=>{
  const value=candidate||(!consumed&&plan);if(!value)return;
  const expire=()=>{if(currentCandidate.current!==value&&currentPlan.current!==value)return;currentCandidate.current=null;currentPlan.current=null;ack.current=false;used.current=true;setCandidate(null);setPlan(null);setChecked(false);setConsumed(true);setError(t('partialExpired'));};
  const delay=value.expiresAt-Date.now();if(delay<=0){expire();return;}const timer=setTimeout(expire,delay);return()=>clearTimeout(timer);
 },[plan,candidate,consumed]);
 const allowed=()=>alive.current&&!locked.current&&!uncertain.current&&!block.current&&!pending&&mode==='unstaged';
 const replan=async()=>{
  if(!allowed())return;locked.current=true;task.current?.abort();const controller=new AbortController();task.current=controller;clear();setOpen(true);setBusy('plan');setError('');
  try{const result=await rpc('vcs/partial-stage-plan',{sessionId,repositoryId,id},controller.signal);if(controller.signal.aborted||!alive.current)return;let value;try{value=validatePartialPlan(result);}catch{throw Error(t('partialInvalid'));}currentPlan.current=value;setPlan(value);}
  catch(e){if(!controller.signal.aborted&&alive.current){setError(message(e,t('partialInvalid')));if(e.code==='vcs/rediscover-required')onRediscover?.();}}
  finally{if(!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const choose=(unitId,checked)=>{
  if(!allowed()||used.current||!currentPlan.current)return;
  if(!currentPlan.current.plan.units.some(unit=>unit.id===unitId))return;
  const next=selection.current.filter(id=>id!==unitId);if(checked)next.push(unitId);selection.current=next;setSelected(next);
 };
 const prepare=async()=>{
  const value=currentPlan.current,ids=[...selection.current];
  if(!allowed()||used.current||!value||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!value.plan.units.some(unit=>unit.id===id)))return;
  if(value.expiresAt<=Date.now()){clear();setError(t('partialExpired'));return;}
  // Host consumes the plan even on failure: never reuse it or change this selection.
  used.current=true;locked.current=true;setConsumed(true);ack.current=false;setChecked(false);setError('');setBusy('prepare');
  const controller=new AbortController();task.current=controller;
  try{const result=await rpc('vcs/partial-stage-prepare',{sessionId,repositoryId,planToken:value.planToken,unitIds:[...ids]},controller.signal);if(controller.signal.aborted||!alive.current)return;let preview;try{preview=validateCandidate(result,value,ids);}catch{throw Error(t('partialInvalid'));}currentCandidate.current=preview;setCandidate(preview);}
  catch(e){if(!controller.signal.aborted&&alive.current){setError(message(e,t('partialInvalid')));if(e.code==='vcs/rediscover-required')onRediscover?.();}}
  finally{if(!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const confirm=async()=>{
  const value=currentCandidate.current;if(!allowed()||!value||!ack.current)return;
  if(value.expiresAt<=Date.now()){clear();setError(t('partialExpired'));return;}
  locked.current=true;confirming.current=true;currentCandidate.current=null;currentPlan.current=null;ack.current=false;setCandidate(null);setPlan(null);setChecked(false);setBusy('confirm');setError('');
  const controller=new AbortController();task.current=controller;
  try{const result=await rpc('vcs/partial-stage-confirm',{sessionId,repositoryId,token:value.token},controller.signal);if(controller.signal.aborted||!alive.current)return;if(result?.path!==value.path||result.head!==value.head||!sameEntry(result.index,value.target))throw Error(t('partialInvalid'));confirming.current=false;setOpen(false);onStaged();}
  catch(e){if(!controller.signal.aborted&&alive.current){markUnknown();setError(message(e,t('partialInvalid')));}}
  finally{if(!controller.signal.aborted&&alive.current){locked.current=false;setBusy('');}}
 };
 const close=()=>{if(!alive.current)return;if(confirming.current)markUnknown();task.current?.abort();locked.current=false;clear();setOpen(false);setBusy('');setError('');};
 return <section aria-label={t('partialTitle')} aria-busy={!!busy} style={{padding:'0 12px',flexShrink:0,maxHeight:'45%',overflow:'auto'}}>
  <button disabled={!!busy||unknown||blocked||pending} aria-expanded={open} onClick={replan}>{t('partialPlan')}</button>
  {(unknown||blocked)?<><p role="alert">{t('stageUnknown')} {error}</p><button onClick={()=>{if(!locked.current)onStaged();}}>{t('stageRecover')}</button></>:open&&<>
   <p>{t('partialScope')}</p><p>{t('partialReadonly')}</p>{busy&&<p role="status">{t(busy==='confirm'?'stagePending':'loading')}</p>}{error&&<p role="alert">{error}</p>}
   {plan&&<section aria-label={t('partialUnits')}><p>{t('stagePath')}: <code>{plan.path}</code></p><p>HEAD: <code>{plan.head}</code></p><p>{t('stageIndex')}: <code>{plan.index.oid}</code> · {plan.index.mode}</p>
    <p>{plan.plan.algorithm} · {plan.plan.beforeBytes} → {plan.plan.afterBytes} bytes · {plan.plan.beforeLineCount} → {plan.plan.afterLineCount} {t('partialLines')} · LCS {plan.plan.lcsCells}</p><p>SHA-256: <code>{plan.plan.beforeHash}</code> → <code>{plan.plan.afterHash}</code></p>
    <p>{t('partialPlanExpires')}: <time dateTime={new Date(plan.expiresAt).toISOString()}>{new Date(plan.expiresAt).toLocaleTimeString()}</time></p>
    {plan.plan.units.map((unit,i)=><section key={unit.id} aria-label={t('partialUnit')+' '+(i+1)}><label><input type="checkbox" aria-label={t('partialUnit')+' '+(i+1)} disabled={!!busy||consumed} checked={selected.includes(unit.id)} onChange={e=>choose(unit.id,e.target.checked)}/>{t('partialUnit')} {i+1}: −{unit.beforeStart+1} ({unit.beforeCount}) / +{unit.afterStart+1} ({unit.afterCount})</label>
     {['before','after'].map(side=><div key={side} aria-label={t(side==='before'?'partialDeleted':'partialAdded')}>{unit[side].map((line,j)=><div key={j} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontFamily:'monospace'}}><span>{side==='before'?'−':'+'}{unit[side+'Start']+j+1} </span><code style={{whiteSpace:'pre-wrap'}}>{line.text}</code><strong> ⟦{line.terminator}⟧</strong></div>)}</div>)}
    </section>)}
    <button disabled={!!busy||consumed||!selected.length} onClick={prepare}>{t('partialPrepare')}</button>
   </section>}
   {consumed&&<p>{t('partialConsumed')}</p>}
   {candidate&&<section role="group" aria-label={t('partialConfirmation')}><p>{t('partialWarning')}</p><p>{t('stagePath')}: <code>{candidate.path}</code></p><p>HEAD: <code>{candidate.head}</code></p><p>{t('stageIndex')}: <code>{candidate.index.oid}</code> · {candidate.index.mode}</p><p>{t('stageTarget')}: <code>{candidate.target.oid}</code> · {candidate.target.mode}</p><p>{t('partialSelected')}: {candidate.unitIds.length}</p><p>{t('stageExpires')}: <time dateTime={new Date(candidate.expiresAt).toISOString()}>{new Date(candidate.expiresAt).toLocaleTimeString()}</time></p>
    <label><input type="checkbox" aria-label={t('partialAcknowledge')} checked={checked} onChange={e=>{if(!alive.current||!currentCandidate.current||locked.current)return;ack.current=e.target.checked;setChecked(e.target.checked);}}/>{t('partialAcknowledge')}</label><button disabled={!!busy||pending||!checked} onClick={confirm}>{t('partialConfirm')}</button>
   </section>}
   <button onClick={close}>{t('partialCancel')}</button><button onClick={close}>{t('partialClose')}</button>
  </>}
 </section>;
}
