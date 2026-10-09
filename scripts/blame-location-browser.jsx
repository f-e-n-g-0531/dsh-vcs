import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import BlamePanel from '../src/BlamePanel.jsx';
export async function checkBlameLocation(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),a='a'.repeat(40),b='b'.repeat(40),calls=[];
 const wait=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Blame location timeout');};
 const text=Array.from({length:30},(_,i)=>'origin '+(i+1)).join('\n');
 const rpc=async(endpoint,p,signal)=>{calls.push({endpoint,p,signal});if(endpoint==='vcs/tree-file')return {text,oid:'c'.repeat(40),encoding:'UTF-8'};if(endpoint==='vcs/blame')return {startLine:p.startLine,totalLines:1002,nextLine:p.startLine===1?501:null,lines:[{line:p.startLine,originalLine:10,path:'中文旧.txt',commit:b,author:'author',summary:'origin',text:'origin 10'}]};throw Error('Unexpected blame RPC');};
 const button=key=>[...host.querySelectorAll('button')].find(n=>n.textContent===key);
 try{
 flushSync(()=>root.render(<BlamePanel sessionId='s' repositoryId='r' commit={a} parentIndex={0} id={'d'.repeat(64)} {...{rpc}} t={k=>k} onRediscover={()=>{throw Error('Rediscovery');}}/>));button('blame').click();await wait(()=>button('blameNext'));
 button('blameNext').click();await wait(()=>host.querySelector('tbody th')?.textContent==='501');if(calls[1].p.startLine!==501||!calls[0].signal.aborted||host.querySelectorAll('tbody tr').length!==1)throw Error('Blame page scope or bounds failed');
 [...host.querySelectorAll('button')].find(n=>n.textContent==='blameOriginLine: 中文旧.txt:10').click();await wait(()=>host.querySelector('.monaco-editor')&&host.querySelector('.selected-text'));
 const request=calls.at(-1);if(request.endpoint!=='vcs/tree-file'||request.p.commit!==b||request.p.path!=='中文旧.txt'||host.querySelector('.monaco-diff-editor'))throw Error('Origin preview not exact single revision');
 if(!host.textContent.includes('blameOriginLine: 10'))throw Error('Origin line not disclosed');
 button('blamePrevious').click();await wait(()=>host.querySelector('tbody th')?.textContent==='1');if(host.querySelector('.monaco-editor'))throw Error('Page change retained stale origin editor');
 }finally{root.unmount();host.remove();}
}
