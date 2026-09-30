import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import HistoricalTree from '../src/HistoricalTree.jsx';
import HistoricalFile from '../src/HistoricalFile.jsx';
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
 const pending=[],requests=[];let fail=true,identity={sessionId:'preview',repositoryId:'r',commit};
 const previewRpc=async(endpoint,p,s)=>{
  requests.push({endpoint,p,s});if(endpoint==='vcs/tree')return {commit:p.commit,entries:['retry-file','empty-file','binary-file','pending-file'].map(path=>({path,type:'blob',mode:'100644',oid}))};
  if(endpoint!=='vcs/tree-file')throw Error('Unexpected preview endpoint');
  if(p.path==='pending-file')return new Promise(resolve=>pending.push({resolve,signal:s}));
  if(p.path==='retry-file'&&fail){fail=false;throw Error('Preview fixture failure');}
  return {commit:p.commit,path:p.path,oid,encoding:'UTF-8',text:p.path==='retry-file'?'recovered':'',binary:p.path==='binary-file',notice:p.path==='binary-file'?'Binary fixture notice':''};
 };
 const renderPreview=()=>flushSync(()=>root.render(<HistoricalTree {...identity} rpc={previewRpc} t={k=>k} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>));
 renderPreview();await wait(()=>button('historicalTree')?.getAttribute('aria-expanded')==='false');button('historicalTree').click();await wait(()=>button('retry-file'));
 button('retry-file').click();await wait(()=>host.querySelector('[role=alert]'));button('retry').click();await wait(()=>host.querySelector('pre')?.textContent==='recovered');
 button('empty-file').click();await wait(()=>host.textContent.includes('treeEmpty'));if(host.querySelector('pre'))throw Error('Empty preview retained text');
 button('binary-file').click();await wait(()=>host.textContent.includes('Binary fixture notice'));if(host.querySelector('pre')||host.textContent.includes('recovered'))throw Error('Binary preview retained text');
 for(const patch of [{sessionId:'changed'},{repositoryId:'changed'},{commit:'c'.repeat(40)}]){
  const before=pending.length;button('pending-file').click();await wait(()=>pending.length>before);const old=pending.at(-1),count=requests.length;
  identity={...identity,...patch};renderPreview();await wait(()=>old.signal.aborted&&button('historicalTree')?.getAttribute('aria-expanded')==='false');
  old.resolve({text:'OLD PREVIEW',oid});await new Promise(r=>setTimeout(r,50));if(host.querySelector('section')||requests.length!==count||host.textContent.includes('OLD PREVIEW'))throw Error('Preview scope leaked or fetched automatically');
  button('historicalTree').click();await wait(()=>button('pending-file'));
 }
 let rediscoveries=0,expiredCalls=0;
 const expiredRpc=async()=>{expiredCalls++;throw Object.assign(Error('Expired preview authorization'),{code:'vcs/rediscover-required'});};
 root.render(<HistoricalFile sessionId='expired' repositoryId='r' commit={commit} path='file.txt' rpc={expiredRpc} t={k=>k} onClose={()=>{}} onRediscover={()=>{rediscoveries++;}}/>);
 await wait(()=>host.querySelector('[role=alert]')?.textContent.includes('Expired preview authorization'));
 if(rediscoveries!==1||expiredCalls!==1||host.querySelector('pre'))throw Error('Expired preview failed rediscovery or retained body');
 await new Promise(r=>setTimeout(r,50));if(expiredCalls!==1)throw Error('Expired preview automatically retried');
 let rejectCancelled,cancelledSignal;
 const cancelledRpc=(_endpoint,_payload,s)=>{cancelledSignal=s;return new Promise((_resolve,reject)=>{rejectCancelled=reject;});};
 root.render(<HistoricalFile key='cancelled' sessionId='s' repositoryId='r' commit={commit} path='late.txt' rpc={cancelledRpc} t={k=>k} onClose={()=>{}} onRediscover={()=>{rediscoveries++;}}/>);
 await wait(()=>rejectCancelled);root.render(<p>replacement context</p>);await wait(()=>cancelledSignal.aborted);
 rejectCancelled(Object.assign(Error('LATE EXPIRED'),{code:'vcs/rediscover-required'}));await new Promise(r=>setTimeout(r,50));
 if(rediscoveries!==1||host.textContent!=='replacement context')throw Error('Cancelled preview triggered late rediscovery');
 let failNext,transitionCalls=0;
 const transitionRpc=async(_endpoint,p)=>{transitionCalls++;if(p.path==='before.txt')return {text:'PREVIOUS BODY',oid,encoding:'UTF-8'};return new Promise((_resolve,reject)=>{failNext=reject;});};
 const showTransition=path=>root.render(<HistoricalFile key='transition' sessionId='s' repositoryId='r' commit={commit} path={path} rpc={transitionRpc} t={k=>k} onClose={()=>{}} onRediscover={()=>{rediscoveries++;}}/>);
 showTransition('before.txt');await wait(()=>host.querySelector('pre')?.textContent==='PREVIOUS BODY');
 showTransition('after.txt');await wait(()=>failNext&&host.querySelector('[role=status]'));
 if(host.querySelector('pre')||host.textContent.includes('PREVIOUS BODY'))throw Error('Changed preview retained old body while loading');
 failNext(Object.assign(Error('Changed path expired'),{code:'vcs/rediscover-required'}));await wait(()=>host.querySelector('[role=alert]'));
 if(rediscoveries!==2||transitionCalls!==2||host.querySelector('pre'))throw Error('Changed preview authorization transition incorrect');
 }finally{root.unmount();host.remove();}
}
