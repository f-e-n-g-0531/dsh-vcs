import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import ConflictStages from '../src/ConflictStages.jsx';
import locales from '../src/locales.json';
function Harness({tick,children}){return <div data-tick={tick}>{children}</div>;}
export async function checkConflictStages(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const wait=async(fn,label)=>{for(let i=0;i<800;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Conflict stages timeout at '+label);};
 const id='b'.repeat(64),a='a'.repeat(40),snapshot='c'.repeat(64);
 try{for(const lang of ['zh','en']){
  const t=k=>locales[lang][k];let mode='normal',pending=[],calls=[],rediscovered=0,tick=1;
  const overLimit='File exceeds the 2 MiB preview limit.',binaryNotice='Binary file; text preview unavailable.';
  const stages=()=>({id,path:'file',snapshot,stages:[
   mode==='binary'?{stage:1,mode:'100644',oid:a,kind:'file',present:true,text:'',binary:true,notice:binaryNotice}:{stage:1,mode:'100644',oid:a,kind:'file',present:true,text:'base\n'},
   mode==='notices'?{stage:2,mode:'100644',oid:a,kind:'file',present:true,text:'',notice:overLimit}:{stage:2,mode:'120000',oid:a,kind:'symlink',present:true,text:'target\n',notice:'Symbolic link target text; not followed.'},
   mode==='binary'?{stage:3,mode:'100644',oid:a,kind:'file',present:true,text:'',binary:true,notice:binaryNotice}:{stage:3,present:false,text:''}]});
  const rpc=async(endpoint,p,signal)=>{if(endpoint!=='vcs/conflict-stages')throw Error('Unexpected conflict endpoint');calls.push({p,signal});
   if(mode==='pending')return new Promise(resolve=>pending.push(()=>resolve(stages())));
   if(mode==='error')throw Error('CONFLICT READ FAILURE');
   if(mode==='expired')throw Object.assign(Error('expired'),{code:'vcs/rediscover-required'});
   return stages();};
  const render=key=>flushSync(()=>root.render(<Harness tick={tick}><ConflictStages key={key} sessionId='s' repositoryId='r' mode='all' id={id} rpc={rpc} t={t} onRediscover={()=>{rediscovered++;}}/></Harness>));
  render(lang);await wait(()=>host.querySelector('[role=status]')&&host.textContent.includes(t('conflictStageAbsent')),'initial-load');
  if(calls[0].p.mode!=='all'||calls[0].p.id!==id||!calls[0].signal)throw Error('Conflict request fields or cancellation signal missing');
  if(!host.textContent.includes(t('conflictStagesScope'))||!host.textContent.includes(t('conflictStage1')))throw Error('Conflict scope or stage inventory missing');
  if(host.querySelectorAll('select').length!==2||host.querySelectorAll('li').length!==3)throw Error('Conflict stage selectors or inventory missing');
  if(!host.textContent.includes(t('conflictStageSymlink'))||!host.textContent.includes(t('conflictStageMissing')))throw Error('Symlink or missing-stage disclosure absent');
  const editor=await (async()=>{await wait(()=>host.querySelector('.monaco-diff-editor'),'monaco-editor');return host.querySelector('.monaco-diff-editor');})();
  if(![...host.querySelectorAll('.view-line')].map(n=>n.textContent).join('|').includes('base'))throw Error('Stage text missing from the rendered diff editor');
  tick=2;render(lang);await new Promise(r=>setTimeout(r,60));
  if(host.querySelector('.monaco-diff-editor')!==editor)throw Error('Ancestor re-render rebuilt the conflict diff editor');
  tick=3;mode='notices';render(lang+'-notices');await wait(()=>host.textContent.includes(overLimit),'inventory-notice');
  const occurrence=()=>host.textContent.split(overLimit).length-1;
  if(occurrence()!==1)throw Error('Over-limit notice missing from the stage inventory');
  const sideSelects=host.querySelectorAll('select'),rightSelect=sideSelects[1];rightSelect.value='2';rightSelect.dispatchEvent(new Event('change',{bubbles:true}));
  await wait(()=>occurrence()>=2,'comparison-notice');if(occurrence()<2)throw Error('Over-limit notice missing from the comparison disclosure');
  tick=4;mode='binary';render(lang+'-binary');await wait(()=>host.textContent.includes(t('binary'))&&host.textContent.includes(binaryNotice),'binary-disclosure');
  if(host.querySelector('.monaco-diff-editor')||!host.textContent.includes(t('conflictStagePresent')))throw Error('Binary stages still rendered an empty diff or lost their inventory state');
  tick=5;mode='error';render(lang+'-error');await wait(()=>host.querySelector('[role=alert]'),'error-alert');
  const before=calls.length;[...host.querySelectorAll('button')].find(b=>b.textContent===t('retry')).click();await wait(()=>calls.length===before+1,'retry-refetch');
  mode='expired';[...host.querySelectorAll('button')].find(b=>b.textContent===t('retry')).click();await wait(()=>rediscovered===1,'rediscovery');
  mode='pending';tick=6;render(lang+'-pending');await wait(()=>pending.length===1,'pending-request');const old=calls.at(-1);tick=7;render(lang+'-next');await wait(()=>old.signal.aborted,'cancel-on-switch');pending.forEach(done=>done());await new Promise(r=>setTimeout(r,30));
  if(host.textContent.includes('base'))throw Error('Stale conflict response replaced the new selection');
  mode='normal';tick=8;render(lang+'-final');await wait(()=>host.textContent.includes(t('conflictStageAbsent')),'final-render');
 }}finally{root.unmount();host.remove();}
}
