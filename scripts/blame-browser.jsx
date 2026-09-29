import React from 'react';
import {createRoot} from 'react-dom/client';
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
 if(host.querySelector('code').title!==commit)throw Error('Missing full commit identity');
 button().click();await wait(()=>!host.querySelector('section'));button().click();await wait(()=>resolveLate);
 button().click();await wait(()=>signal.aborted);resolveLate({lines:[{line:1,commit,author:'STALE',summary:'',text:''}],truncated:false});
 await new Promise(r=>setTimeout(r,50));if(host.textContent.includes('STALE')||calls!==2)throw Error('Closed blame accepted stale result');
 }finally{root.unmount();host.remove();}
}
