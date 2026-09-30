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
 }}finally{root.unmount();host.remove();}
}
