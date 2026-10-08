import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import HistoryPanel from '../src/HistoryPanel.jsx';
import locales from '../src/locales.json';
export async function checkHistoryRefs(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('History refs timeout');};
 const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
 const a='a'.repeat(40),b='b'.repeat(40),name='refs/heads/中文<img>';
 try{for(const language of ['zh','en']){
  const t=k=>locales[language][k],calls=[];let loads=0;
  const rpc=async(endpoint,p)=>{calls.push({endpoint,p});
   if(endpoint==='vcs/history')return {snapshot:a,nextOffset:null,commits:[a,b].map((id,i)=>({id,parents:[],subject:'subject'+i,author:'author',date:'2026-09-30T00:00:00Z'}))};
   if(endpoint==='vcs/commit')return {id:p.commit,subject:'details',parents:[],changes:[],message:''};
   if(endpoint==='vcs/revision-changes')return {changes:[]};
   if(endpoint==='vcs/references'){loads++;if(loads===3)throw Error('REFRESH FAILURE');return {references:loads===4?[]:[name,'refs/tags/one','refs/tags/two','refs/tags/three'].map(name=>({name,commit:loads===1?a:b}))};}
   throw Error('Unexpected history refs endpoint');
  };
  flushSync(()=>root.render(<HistoryPanel key={language} sessionId={language} repositoryId='r' rpc={rpc} t={t} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>));
  await wait(()=>button('subject0'));const labels=()=>[...host.querySelectorAll('[aria-label="'+t('historyRefsLabel')+'"]')];
  if(labels().length||calls.length!==1)throw Error('References appeared or loaded before opt-in');
  button('subject0').click();await wait(()=>host.querySelector('[aria-label="'+t('commitDetails')+'"]'));
  const choose=(i,value)=>{const s=host.querySelectorAll('select')[i];s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));};choose(0,a);choose(1,b);await wait(()=>calls.some(c=>c.endpoint==='vcs/revision-changes'));
  const before=calls.length;button(t('revisionLoadRefs')).click();await wait(()=>labels().length===1);
  if(labels()[0].closest('li').querySelector('button').textContent!=='subject0'||labels()[0].querySelectorAll('code').length!==3||!labels()[0].textContent.includes(t('historyRefsMore')+': 1')||labels()[0].querySelector('img')||!labels()[0].textContent.includes(name)||!host.textContent.includes(t('historyRefsScope')))throw Error('Reference rendering identity limit or escaping failed');
  button(t('revisionLoadRefs')).click();await wait(()=>labels()[0]?.closest('li').querySelector('button').textContent==='subject1');
  if(button('subject0').getAttribute('aria-pressed')!=='true'||host.querySelectorAll('select')[0].value!==a||host.querySelectorAll('select')[1].value!==b||calls.length!==before+2)throw Error('Reference refresh moved fixed review identity');
  button(t('revisionLoadRefs')).click();await wait(()=>host.textContent.includes('REFRESH FAILURE'));if(labels().length!==1)throw Error('Failed refresh discarded prior labels');
  button(t('revisionLoadRefs')).click();await wait(()=>loads===4&&!labels().length&&!host.textContent.includes('REFRESH FAILURE'));
  if(calls.filter(c=>c.endpoint==='vcs/history').length!==1)throw Error('Reference refresh reloaded history snapshot');
 }
 for(const language of ['zh','en']){
  const t=k=>locales[language][k];let historyCalls=0,refsCalls=0;
  const rpc=async endpoint=>{
   if(endpoint==='vcs/history'){historyCalls++;return {snapshot:a,nextOffset:null,commits:[{id:a,parents:[],subject:'initial-failure',author:'author',date:'2026-09-30T00:00:00Z'}]};}
   if(endpoint==='vcs/references'){refsCalls++;if(refsCalls===1)throw Error('FIRST REF FAILURE');return {references:[{name:'refs/heads/recovered',commit:a}]};}
   throw Error('Unexpected retry RPC');
  };
  flushSync(()=>root.render(<HistoryPanel key={'retry-'+language} sessionId='retry' repositoryId='r' rpc={rpc} t={t}/>));
  await wait(()=>button('initial-failure'));button(t('revisionLoadRefs')).click();await wait(()=>host.textContent.includes('FIRST REF FAILURE'));
  if(host.textContent.includes(t('historyRefsScope'))||host.querySelector('[aria-label="'+t('historyRefsLabel')+'"]')||historyCalls!==1||refsCalls!==1)throw Error('Initial failure fabricated successful reference snapshot');
  button(t('revisionLoadRefs')).click();await wait(()=>host.textContent.includes('refs/heads/recovered')&&!host.textContent.includes('FIRST REF FAILURE'));
  if(!host.textContent.includes(t('historyRefsScope'))||historyCalls!==1||refsCalls!==2)throw Error('Explicit reference retry lost history or scope');
 }
 for(const outcome of ['success','error']){
  const calls=[];let identity={sessionId:'scope',repositoryId:'r'},loads=0,pending,rediscoveries=0;
  const rpc=async(endpoint,p,signal)=>{calls.push({endpoint,p});if(endpoint==='vcs/history')return {snapshot:a,nextOffset:p.offset?null:50,commits:[{id:p.offset?b:a,subject:p.offset?'page-two':'page-one',parents:[],author:'author',date:'2026-09-30T00:00:00Z'}]};if(endpoint==='vcs/references'){loads++;if(loads===1)return {references:[{commit:b,name:'refs/tags/page-two'}]};return new Promise((resolve,reject)=>pending={resolve,reject,signal});}throw Error('Unexpected scoped refs RPC');};
  const render=()=>flushSync(()=>root.render(<HistoryPanel key={outcome} {...identity} rpc={rpc} t={k=>k} onRediscover={()=>{rediscoveries++;}}/>));
  render();await wait(()=>button('page-one'));button('revisionLoadRefs').click();await wait(()=>host.textContent.includes('historyRefsScope'));
  if(host.querySelector('[aria-label=historyRefsLabel]'))throw Error('Unloaded commit received visible label');
  button('historyMore').click();await wait(()=>button('page-two')&&host.querySelector('[aria-label=historyRefsLabel]'));
  if(calls.at(-1).p.snapshot!==a||calls.at(-1).p.offset!==50||loads!==1||host.querySelector('[aria-label=historyRefsLabel]').closest('li').querySelector('button').textContent!=='page-two')throw Error('Paginated reference identity or snapshot changed');
  for(const patch of [{sessionId:'next'},{repositoryId:'next'}]){
   pending=null;button('revisionLoadRefs').click();await wait(()=>pending);const old=pending,count=calls.length;
   identity={...identity,...patch};render();await wait(()=>old.signal.aborted&&button('page-one'));
   if(outcome==='success')old.resolve({references:[{commit:a,name:'refs/heads/STALE'}]});else old.reject(Object.assign(Error('STALE ERROR'),{code:'vcs/rediscover-required'}));
   await new Promise(r=>setTimeout(r,50));if(host.querySelector('[aria-label=historyRefsLabel]')||host.textContent.includes('historyRefsScope')||host.textContent.includes('STALE')||rediscoveries||calls.length!==count+1)throw Error('Scoped references leaked or auto-loaded');
  }
 }
 }finally{root.unmount();host.remove();}
}
