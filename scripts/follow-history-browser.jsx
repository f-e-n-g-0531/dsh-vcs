import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import FileHistory from '../src/FileHistory.jsx';import locales from '../src/locales.json';
export async function checkFollowHistory(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),commit='a'.repeat(40),id='b'.repeat(64);
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Follow UI timeout');};
 try{for(const lang of ['zh','en']){
  const t=k=>locales[lang][k],calls=[];let navigation;
  const rpc=async(_e,p,signal)=>{calls.push({p,signal});return {path:'new.txt',commits:[{id:commit,subject:p.follow?'old revision':'path revision',path:p.follow?'old.txt':undefined,similarity:p.follow?87:undefined,boundary:p.follow?'ambiguous-rename':undefined,author:'a',date:'2026-10-09'}],nextOffset:null};};
  flushSync(()=>root.render(<FileHistory key={lang} {...{commit,id,rpc,t}} sessionId='s' repositoryId='r' parentIndex={0} onRediscover={()=>{}} onSelectCommit={(...args)=>navigation=args}/>));
  await wait(()=>host.querySelector('button'));host.querySelector('button').click();await wait(()=>host.textContent.includes('path revision'));
  host.querySelector('input[type=checkbox]').click();await wait(()=>host.textContent.includes('old revision'));
  if(calls.length!==2||!calls[1].p.follow||calls[1].p.offset!==0||!calls[0].signal.aborted||!host.textContent.includes(t('fileHistoryAmbiguous'))||!host.textContent.includes(t('fileHistorySimilarity')+': 87%'))throw Error('Follow mode did not reset scoped request');
  [...host.querySelectorAll('button')].find(b=>b.textContent==='old revision').click();if(navigation[0]!==commit||navigation[1]!=='old.txt')throw Error('Follow row used current path');
  host.querySelector('input[type=checkbox]').click();await wait(()=>host.textContent.includes('path revision'));if(calls.length!==3||calls[2].p.follow||!calls[1].signal.aborted)throw Error('Follow reset lost path mode');
 }}finally{root.unmount();host.remove();}
}
