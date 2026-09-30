import React from 'react';
import {createRoot} from 'react-dom/client';
import HistoricalTree from '../src/HistoricalTree.jsx';
export async function checkTree(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const commit='a'.repeat(40),oid='b'.repeat(40);let calls=0,resolveLate,signal;
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Tree UI timeout');};
 const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
 const entries=[{path:'nested',mode:'040000',type:'tree',oid},...Array.from({length:101},(_,i)=>({path:'nested/file'+i,mode:'100644',type:'blob',oid})),{path:'link',mode:'120000',type:'blob',oid},{path:'submodule',mode:'160000',type:'commit',oid}];
 let fileCalls=0,fileSignal,lateFile;const source='<img src=x onerror=alert(1)>\n中文';
 const rpc=async(endpoint,p,s)=>{if(endpoint==='vcs/tree-file'){fileCalls++;fileSignal=s;if(p.path==='nested/file1')return new Promise(resolve=>lateFile=resolve);return {commit,path:p.path,oid,encoding:'UTF-8',text:source};}calls++;if(endpoint!=='vcs/tree'||p.commit!==commit||Object.keys(p).length!==3)throw Error('Invalid tree request');if(calls===2){signal=s;return new Promise(resolve=>resolveLate=resolve);}return {commit,entries};};
 try{
 root.render(<HistoricalTree {...{commit,rpc}} sessionId="s" repositoryId="r" t={key=>key} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>);
 await wait(()=>button('historicalTree'));if(calls)throw Error('Tree queried before opt-in');button('historicalTree').click();await wait(()=>button('nested/'));
 if(host.querySelectorAll('li').length!==3||button('link')||button('submodule'))throw Error('Special objects are navigable');
 button('nested/').click();await wait(()=>button('treeNext'));if(host.querySelectorAll('li').length!==100)throw Error('First page unbounded');
 if(fileCalls)throw Error('Preview read before selection');button('file0').click();await wait(()=>host.querySelector('pre'));if(host.querySelector('pre').textContent!==source||host.querySelector('pre img'))throw Error('Preview did not render literal text');
 button('treeClose').click();await wait(()=>!host.querySelector('pre'));if(!fileSignal.aborted)throw Error('Closed preview still active');
 button('file1').click();await wait(()=>lateFile);button('treeClose').click();await wait(()=>fileSignal.aborted);lateFile({text:'STALE FILE',oid});await new Promise(r=>setTimeout(r,50));if(host.textContent.includes('STALE FILE'))throw Error('Late preview leaked');
 button('treeNext').click();await wait(()=>button('treePrevious'));if(host.querySelectorAll('li').length!==1||button('treeNext'))throw Error('Last page incorrect');
 const search=host.querySelector('input[aria-label=treeSearch]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search,'file100');search.dispatchEvent(new Event('input',{bubbles:true}));
 await wait(()=>host.querySelectorAll('li').length===1&&!button('treePrevious'));if(!host.textContent.includes('file100')||calls!==1)throw Error('Tree filter failed to reset page or made RPC');
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search,'');search.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>host.querySelectorAll('li').length===100);
 button('treeUp').click();await wait(()=>button('nested/'));if(calls!==1)throw Error('Navigation made extra RPC');
 button('historicalTree').click();await wait(()=>!host.querySelector('section'));button('historicalTree').click();await wait(()=>resolveLate);
 button('historicalTree').click();await wait(()=>signal.aborted);resolveLate({commit,entries:[{path:'STALE',mode:'100644',type:'blob',oid}]});
 await new Promise(r=>setTimeout(r,50));if(host.textContent.includes('STALE')||calls!==2)throw Error('Closed tree accepted stale response');
 }finally{root.unmount();host.remove();}
}
