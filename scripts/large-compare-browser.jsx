import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import HistoryComparison from '../src/HistoryComparison.jsx';

export async function checkLargeCompare(){
 const initialEnvironment=globalThis.MonacoEnvironment;
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const calls=[];let mode='normal',pending;
 const text=('line '+ 'x'.repeat(110)+'\n').repeat(24000);
 const value={path:'large.txt',large:true,left:{text},right:{text:'INSERTED\n'+text.replace('line ','CHANGED ')+'EOF ADDED\n'}};
 const rpc=async(endpoint,p,signal)=>{
  if(!endpoint.endsWith('compare'))return endpoint.endsWith('image')?{absent:true}:{commits:[],rows:[]};
  calls.push({p,signal});
  if(!p.large)return {path:'large.txt',left:{text:''},right:{text:''},notice:'File exceeds the 2 MiB preview limit.'};
  if(mode==='pending')return new Promise(resolve=>pending=()=>resolve(value));
  if(mode==='error')throw Error('Large read failed');
  return value;
 };
 const render=(repositoryId='r')=>flushSync(()=>root.render(<HistoryComparison sessionId='s' repositoryId={repositoryId} base={'a'.repeat(40)} target={'b'.repeat(40)} id={'c'.repeat(64)} rpc={rpc} t={k=>k}/>));
 const button=k=>[...host.querySelectorAll('button')].find(n=>n.textContent===k);
 const wait=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Large compare browser timeout: '+host.textContent.slice(0,200));};
 try{
  const editorURL=new URL('../dist/editor.js',document.baseURI).href;
  const module=await import(editorURL);
  const target=document.createElement('div');target.style.height='360px';host.appendChild(target);
  let stats,status;const editor=module.createDiff(target,{onStats:value=>stats=value,onComputation:value=>status=value});
  try{
   editor.setContent(value,'complete-large');await wait(()=>status==='complete'&&stats?.count>0);
   if(stats.added<2||stats.deleted<1)throw Error('Full multi-MiB differences not computed');
   const snapshot=editor.snapshot();
   if(snapshot.lengths[0]!==value.left.text.length||snapshot.lengths[1]!==value.right.text.length||snapshot.lines[0]!==24001||snapshot.lines[1]!==24003)throw Error('Large models incomplete');
   if(!snapshot.changes.some(change=>change.originalStartLineNumber<=1&&change.modifiedStartLineNumber<=2))throw Error('Initial insertion/change not located');
   if(!snapshot.changes.some(change=>change.modifiedEndLineNumber>=24002))throw Error('EOF difference missing');
  }finally{editor.dispose();if(editor.snapshot()!==null)throw Error('Disposed editor retained models');target.remove();}
  const timedNode=document.createElement('div');timedNode.style.height='360px';host.appendChild(timedNode);
  let timedStatus;const timed=module.createDiff(timedNode,{maxComputationTime:1,onComputation:state=>timedStatus=state});
  try{
   const lines=Array.from({length:50000},(_,i)=>'line-'+i+'-'+('x'.repeat(40)));
   timed.setContent({path:'time.txt',left:{text:lines.join('\n')},right:{text:[...lines].reverse().join('\n')}},'timeout');
   await wait(()=>timedStatus==='incomplete');
   if(timed.snapshot().computation==='complete')throw Error('Timed out result claimed complete');
  }finally{timed.dispose();timedNode.remove();}
  render();await wait(()=>button('largeLoad'));if(calls.some(c=>c.p.large))throw Error('Automatic large read');
  button('largeLoad').click();await wait(()=>host.textContent.includes('diffComplete'));
  if(!host.querySelector('.monaco-diff-editor')||calls.at(-1).p.large!==true)throw Error('No advanced full comparison');
  button('historyBasic').click();await wait(()=>host.textContent.includes('largeFallback')&&!host.querySelector('.monaco-diff-editor'));
  button('largeClose').click();await wait(()=>button('largeLoad'));
  mode='error';button('largeLoad').click();await wait(()=>host.querySelector('[role=alert]'));mode='normal';button('retry').click();await wait(()=>host.textContent.includes('diffComplete'));
  button('largeClose').click();await wait(()=>button('largeLoad'));mode='pending';button('largeLoad').click();await wait(()=>pending);const old=calls.at(-1);
  render('next');if(!old.signal.aborted)throw Error('Switch failed to cancel large read');pending();await wait(()=>button('largeLoad'));if(host.textContent.includes('diffComplete')||calls.at(-1).p.large)throw Error('Late data revived or mode retained');
 }finally{root.unmount();host.remove();if(globalThis.MonacoEnvironment!==initialEnvironment)throw Error('Large comparison worker ownership leaked');}
}
