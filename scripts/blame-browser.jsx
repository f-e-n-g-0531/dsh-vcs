import React from 'react';
import locales from '../src/locales.json';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import BlamePanel from '../src/BlamePanel.jsx';
export async function checkBlame(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const commit='a'.repeat(40),id='b'.repeat(64);let calls=0,resolveLate,signal;
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Blame UI timeout');};
 const button=()=>host.querySelector('button');
 const source='<img src=x onerror=alert(1)>';
 const rpc=async(endpoint,p,s)=>{
  calls++;if(endpoint!=='vcs/blame'||p.commit!==commit||p.id!==id)throw Error('Invalid blame request');
  if(calls===2){signal=s;return new Promise(resolve=>resolveLate=resolve);}
  return {lines:[{line:1,commit,author:'Author',summary:'Summary',text:source}],truncated:true};
 };
 try{
 root.render(<BlamePanel {...{commit,id,rpc}} parentIndex={0} sessionId="s" repositoryId="r" t={key=>key} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>);
 await wait(()=>button());if(calls)throw Error('Blame queried before opt-in');button().click();
 await wait(()=>host.querySelector('tbody tr'));
 if(host.querySelector('pre').textContent!==source||host.querySelector('img'))throw Error('Source was not rendered as plain text');
 if(!host.textContent.includes('blameLimit')||!host.textContent.includes('blameScope'))throw Error('Missing boundedness notice');
 if(host.querySelector('tbody button'))throw Error('Blame without callback became navigable');
 if(host.querySelector('code').title!==commit)throw Error('Missing full commit identity');
 button().click();await wait(()=>!host.querySelector('section'));button().click();await wait(()=>resolveLate);
 button().click();await wait(()=>signal.aborted);resolveLate({lines:[{line:1,commit,author:'STALE',summary:'',text:''}],truncated:false});
 await new Promise(r=>setTimeout(r,50));if(host.textContent.includes('STALE')||calls!==2)throw Error('Closed blame accepted stale result');
 for(const language of ['zh','en']){
 const selections=[];
 flushSync(()=>root.render(<BlamePanel key={language} {...{commit,id,rpc}} parentIndex={0} sessionId='s' repositoryId='r' t={key=>locales[language][key]} onRediscover={()=>{}} onSelectCommit={(...args)=>selections.push(args)}/>));
 await wait(()=>button()?.getAttribute('aria-expanded')==='false');button().click();await wait(()=>host.querySelector('tbody button'));
 if(!host.textContent.includes(locales[language].blameNavigation)||host.querySelector('pre').textContent!==source)throw Error('Localized blame hint or literal source missing');
 const link=host.querySelector('tbody button'),before=calls;
 if(link.title!==commit||link.textContent!==commit.slice(0,10))throw Error('Blame navigation identity incorrect');
 link.focus();if(selections.length||calls!==before)throw Error('Focus activated blame navigation');
 link.click();if(selections.length!==1||selections[0].length!==1||selections[0][0]!==commit||calls!==before)throw Error('Blame passed path or queried during navigation callback');
 }
 }finally{root.unmount();host.remove();}
}
