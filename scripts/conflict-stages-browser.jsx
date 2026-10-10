import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import ConflictStages from '../src/ConflictStages.jsx';
import locales from '../src/locales.json';
export async function checkConflictStages(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Conflict stages timeout');};
 const id='b'.repeat(64),a='a'.repeat(40);
 try{for(const lang of ['zh','en']){
  const t=k=>locales[lang][k];let mode='normal',pending=[],calls=[],rediscovered=0;
  const rpc=async(endpoint,p,signal)=>{if(endpoint!=='vcs/conflict-stages')throw Error('Unexpected conflict endpoint');calls.push({p,signal});
   if(mode==='pending')return new Promise(resolve=>pending.push(()=>resolve(stages())));
   if(mode==='error')throw Error('CONFLICT READ FAILURE');
   if(mode==='expired')throw Object.assign(Error('expired'),{code:'vcs/rediscover-required'});
   return stages();};
  const stages=()=>({id,path:'file',snapshot:'c'.repeat(64),stages:[{stage:1,mode:'100644',oid:a,kind:'file',present:true,text:'base\n'},{stage:2,mode:'120000',oid:a,kind:'symlink',present:true,text:'target\n',notice:'link'},{stage:3,present:false,text:''}]});
  const render=key=>flushSync(()=>root.render(<ConflictStages key={key} sessionId='s' repositoryId='r' mode='all' id={id} rpc={rpc} t={t} onRediscover={()=>{rediscovered++;}}/>));
  render(lang);await wait(()=>host.querySelector('[role=status]')&&host.textContent.includes(t('conflictStageAbsent')));
  if(calls[0].p.mode!=='all'||calls[0].p.id!==id||!calls[0].signal)throw Error('Conflict request fields or cancellation signal missing');
  if(!host.textContent.includes(t('conflictStagesScope'))||!host.textContent.includes('base\n'))throw Error('Conflict scope or base stage text missing');
  if(host.querySelectorAll('select').length!==2||host.querySelectorAll('li').length!==3)throw Error('Conflict stage selectors or inventory missing');
  if(!host.textContent.includes(t('conflictStageSymlink'))||!host.textContent.includes(t('conflictStageMissing')))throw Error('Symlink or missing-stage disclosure absent');
  const before=calls.length;mode='error';const retry=[...host.querySelectorAll('button')].find(b=>b.textContent===t('retry'));retry.click();await wait(()=>host.querySelector('[role=alert]'));if(calls.length!==before+1)throw Error('Conflict retry did not refetch');
  mode='expired';[...host.querySelectorAll('button')].find(b=>b.textContent===t('retry')).click();await wait(()=>rediscovered===1);
  mode='pending';render(lang+'-pending');await wait(()=>pending.length===1);const old=calls.at(-1);render(lang+'-next');await wait(()=>old.signal.aborted);pending.forEach(done=>done());await new Promise(r=>setTimeout(r,30));
  if(host.textContent.includes('base\n'))throw Error('Stale conflict response replaced the new selection');
  mode='normal';await wait(()=>host.textContent.includes('base\n'));
 }}finally{root.unmount();host.remove();}
}
