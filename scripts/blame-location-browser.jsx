import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import BlamePanel from '../src/BlamePanel.jsx';
export async function checkBlameLocation(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),a='a'.repeat(40),b='b'.repeat(40),calls=[],selected=[];
 const wait=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Blame location timeout');};
 const text=Array.from({length:30},(_,i)=>'origin '+(i+1)).join('\n');
 const rows=p=>({startLine:p.startLine,totalLines:1002,nextLine:p.startLine===1?501:null,lines:[{line:p.startLine,originalLine:10,path:'中文旧.txt',commit:b,author:'author',summary:'origin',text:'origin 10'},{line:p.startLine+1,commit:'c'.repeat(40),author:'author',summary:'mapped',text:'origin 11'}]});
 const rpc=async(endpoint,p,signal)=>{calls.push({endpoint,p,signal});if(endpoint==='vcs/tree-file')return {text,oid:'c'.repeat(40),encoding:'UTF-8'};if(endpoint==='vcs/blame')return rows(p);throw Error('Unexpected blame RPC');};
 const button=key=>[...host.querySelectorAll('button')].find(n=>n.textContent===key);
 const commitButton=id=>[...host.querySelectorAll('tbody button')].find(n=>n.textContent===id.slice(0,10));
 try{
 flushSync(()=>root.render(<BlamePanel sessionId='s' repositoryId='r' commit={a} parentIndex={0} id={'d'.repeat(64)} {...{rpc}} t={k=>k} onSelectCommit={(commit,path)=>selected.push([commit,path])} onRediscover={()=>{throw Error('Rediscovery');}}/>));button('blame').click();await wait(()=>button('blameNext'));
 if(!host.textContent.includes('blameNavigation'))throw Error('Blame navigation scope not disclosed');
 commitButton(b).click();if(JSON.stringify(selected)!==JSON.stringify([[b,'中文旧.txt']]))throw Error('Attributed commit did not forward its exact committed path: '+JSON.stringify(selected));
 commitButton('c'.repeat(40)).click();if(JSON.stringify(selected.at(-1))!==JSON.stringify(['c'.repeat(40),null]))throw Error('Row without a committed path invented one');
 button('blameNext').click();await wait(()=>host.querySelector('tbody th')?.textContent==='501');if(calls[1].p.startLine!==501||!calls[0].signal.aborted||host.querySelectorAll('tbody tr').length!==2)throw Error('Blame page scope or bounds failed');
 [...host.querySelectorAll('button')].find(n=>n.textContent==='blameOriginLine: 中文旧.txt:10').click();await wait(()=>host.querySelector('.monaco-editor')&&host.querySelector('.selected-text'));
 const request=calls.at(-1);if(request.endpoint!=='vcs/tree-file'||request.p.commit!==b||request.p.path!=='中文旧.txt'||host.querySelector('.monaco-diff-editor'))throw Error('Origin preview not exact single revision');
 if(!host.textContent.includes('blameOriginLine: 10'))throw Error('Origin line not disclosed');
 button('blamePrevious').click();await wait(()=>host.querySelector('tbody th')?.textContent==='1');if(host.querySelector('.monaco-editor'))throw Error('Page change retained stale origin editor');
 }finally{root.unmount();host.remove();}
}
