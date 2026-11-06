import React,{useEffect,useRef,useState} from 'react';
import {validBranchCreateName} from './BranchCreate.jsx';

const record=(value,names)=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const own=Reflect.ownKeys(value);if(own.length!==names.length||own.some(key=>!names.includes(key)))return null;
 const out={};for(const key of names){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))return null;out[key]=d.value;}return out;
};
const safeRef=ref=>typeof ref==='string'&&ref.startsWith('refs/heads/')&&validBranchCreateName(ref.slice(11));
const safeScope=value=>typeof value==='string'&&!!value&&value.length<=4096&&!/[\p{Cc}\p{Cf}]/u.test(value);
export function captureBranchDeletePreview(value,submitted){
 const v=record(value,['action','name','ref','objectFormat','current','target','merged','proof','planId']);if(!v)return null;
 const width=v.objectFormat==='sha1'?40:v.objectFormat==='sha256'?64:0;
 const oid=id=>typeof id==='string'&&id.length===width&&/^[a-f0-9]+$/.test(id)&&!/^0+$/.test(id);
 const current=record(v.current,['ref','oid']),target=record(v.target,['ref','oid']);
 if(!width||v.action!=='branch-delete'||!validBranchCreateName(submitted.name)||v.name!==submitted.name||v.ref!=='refs/heads/'+submitted.name||!safeRef(v.ref)||!current||!target||!safeRef(current.ref)||target.ref!==v.ref||current.ref.toLowerCase()===target.ref.toLowerCase()||!oid(current.oid)||!oid(target.oid)||v.merged!==true||typeof v.planId!=='string'||!/^[a-f0-9]{64}$/.test(v.planId))return null;
 if(!Array.isArray(v.proof)||!v.proof.length||v.proof.length>10000||Reflect.ownKeys(v.proof).length!==v.proof.length+1)return null;
 const proof=[];for(let i=0;i<v.proof.length;i++){const d=Object.getOwnPropertyDescriptor(v.proof,String(i));if(!d||!Object.hasOwn(d,'value')||!oid(d.value))return null;proof.push(d.value);}
 if(new Set(proof).size!==proof.length||proof[0]!==current.oid||proof.at(-1)!==target.oid)return null;
 return Object.freeze({...v,current:Object.freeze({...current}),target:Object.freeze({...target}),proof:Object.freeze(proof)});
}
// Page indexes are zero-based; start/end are slice offsets (end exclusive).
export function getProofPage(proof,page){
 const total=proof.length,pageCount=Math.ceil(total/100);
 if(!Number.isInteger(page)||page<0||page>=pageCount)throw new RangeError('Invalid proof page');
 const start=page*100,end=Math.min(start+100,total);
 return {page,pageCount,total,start,end,items:proof.slice(start,end)};
}
function ProofViewer({proof,t}){
 const [open,setOpen]=useState(false),[page,setPage]=useState(0),view=getProofPage(proof,page);
 return <details className="vcs-proof" onToggle={e=>setOpen(e.currentTarget.open)}><summary>{t('branchDeletePreviewPath')}</summary>{open&&<>
 <p>{t('branchDeletePreviewPage')}: {view.page+1} / {view.pageCount} · {t('branchDeletePreviewTotal')}: {view.total}</p>
 <button aria-label={t('branchDeletePreviewPrevious')} disabled={page===0} onClick={()=>setPage(p=>Math.max(0,p-1))}>{t('branchDeletePreviewPrevious')}</button>
 <button aria-label={t('branchDeletePreviewNext')} disabled={page===view.pageCount-1} onClick={()=>setPage(p=>Math.min(view.pageCount-1,p+1))}>{t('branchDeletePreviewNext')}</button>
 <ol start={view.start+1}>{view.items.map(id=><li key={id}><code>{id}</code></li>)}</ol>
 </>}</details>;
}
export default function BranchDeletePreview(props){return <ScopedPreview key={JSON.stringify([props.sessionId,props.repositoryId,props.refresh,props.mode,props.scope])} {...props}/>;}
function ScopedPreview({sessionId,repositoryId,rpc,t,blocked=false,pending=false}){
 const [name,setName]=useState(''),[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const resultVersion=useRef(0),draftGeneration=useRef(0),generation=draftGeneration.current;
 const [,rerenderDraft]=useState(0);
 const alive=useRef(true),task=useRef(null),locked=useRef(false),access=useRef(false),draft=useRef(name);
 draft.current=name;access.current=!blocked&&!pending&&safeScope(sessionId)&&safeScope(repositoryId);
 const clear=()=>{draftGeneration.current++;rerenderDraft(n=>n+1);task.current?.abort();task.current=null;locked.current=false;setPreview(null);setBusy(false);setError('');};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;task.current?.abort();};},[]);
 useEffect(()=>{if(blocked||pending)clear();},[blocked,pending]);
 const assess=async()=>{
  if(!alive.current||!access.current||locked.current||name!==draft.current||generation!==draftGeneration.current)return;
  setPreview(null);setError('');if(!validBranchCreateName(name)){setError(t('branchDeletePreviewInvalidDraft'));return;}
  const submitted=Object.freeze({sessionId,repositoryId,name}),controller=new AbortController();task.current=controller;locked.current=true;setBusy(true);
  const active=()=>generation===draftGeneration.current&&alive.current&&access.current&&!controller.signal.aborted&&task.current===controller&&draft.current===submitted.name;
  try{const value=await rpc('vcs/branch-delete-preview',submitted,controller.signal);if(!active())return;const snapshot=captureBranchDeletePreview(value,submitted);if(!snapshot)throw Error(t('branchDeletePreviewInvalid'));setPreview({snapshot,version:++resultVersion.current});}
  catch(e){if(active())setError(e.message||t('branchDeletePreviewInvalid'));}
  finally{if(task.current===controller&&alive.current){task.current=null;locked.current=false;setBusy(false);}}
 };
 const snapshot=preview?.snapshot;
 return <section className="vcs-op" aria-label={t('branchDeletePreviewTitle')} aria-busy={busy}>
 <h3>{t('branchDeletePreviewTitle')}</h3><details className="vcs-help"><summary>{t('operationDetails')}</summary><p>{t('branchDeletePreviewScope')}</p><p>{t('branchDeletePreviewBounds')}</p></details><p>{t('branchDeletePreviewConstraints')}</p>
 <label>{t('branchDeletePreviewName')}<input aria-label={t('branchDeletePreviewName')} maxLength={1000} value={name} disabled={blocked||pending} onChange={e=>{if(!alive.current||!access.current)return;clear();draft.current=e.target.value.slice(0,1000);setName(draft.current);}}/></label>
 <div className="vcs-op-actions"><button disabled={busy||blocked||pending} onClick={assess}>{t('branchDeletePreviewAssess')}</button></div>
 {busy&&<p role="status">{t('loading')}</p>}{error&&<p role="alert">{error}</p>}{(blocked||pending)&&<p role="status">{t('branchDeletePreviewBlocked')}</p>}
 {preview&&<section role="group" aria-label={t('branchDeletePreviewResult')}><p>{t('branchDeletePreviewWarning')}</p><p>{t('branchDeletePreviewName')}: <code>{snapshot.name}</code></p><p>{t('branchDeletePreviewRef')}: <code>{snapshot.ref}</code></p><p>{t('branchDeletePreviewCurrent')}: <code>{snapshot.current.ref}</code> <code>{snapshot.current.oid}</code></p><p>{t('branchDeletePreviewTarget')}: <code>{snapshot.target.ref}</code> <code>{snapshot.target.oid}</code></p><p>{t('commitFormat')}: <code>{snapshot.objectFormat}</code></p><p>{t('branchDeletePreviewCount')}: {snapshot.proof.length}</p><ProofViewer key={preview.version} proof={snapshot.proof} t={t}/></section>}
 <button onClick={()=>{if(alive.current&&generation===draftGeneration.current)clear();}}>{t('branchDeletePreviewCancel')}</button>
 </section>;
}
