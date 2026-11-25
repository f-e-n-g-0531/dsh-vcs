import React from 'react';
import {createRoot} from 'react-dom/client';
import {createPage} from '../src/client.jsx';

export async function checkWorkspaceStability(){
 const host=document.createElement('div');host.style.cssText='width:720px;height:650px';document.body.append(host);
 const root=createRoot(host),fetcher=globalThis.fetch;
 const wait=async(fn,label)=>{for(let n=0;n<200;n++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Workspace stability: '+label);};
 const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
 const change={id:'change',status:'modified',path:'file.txt'};
 const comparison=text=>({...change,left:{label:'HEAD',text:'before'},right:{label:'Working',text}});
 const focus=()=>window.dispatchEvent(new FocusEvent('focus'));
 let editorReads=0,discoveries=0,statusReads=0,compares=0,completeStatus,completeCompare,failStatus=true;
 globalThis.fetch=(url,...args)=>{if(String(url).includes('vcs-assets/editor.js'))editorReads++;return fetcher(url,...args);};
 const rpc=async(_route,endpoint)=>{
  if(endpoint==='vcs/repositories'){discoveries++;return {ok:true,value:{cwd:'/fixture',repositories:[{id:'r',type:'git',root:'/fixture'}]}};}
  if(endpoint==='vcs/status'){
   statusReads++;
   if(failStatus)return {ok:false,error:{code:'vcs/rediscover-required',message:'test authorization expired'}};
   if(statusReads>3)return new Promise(resolve=>completeStatus=(changes=[change])=>resolve({ok:true,value:{changes}}));
   return {ok:true,value:{changes:[change]}};
  }
  if(endpoint==='vcs/compare'){compares++;if(compares>1)return new Promise(resolve=>completeCompare=text=>resolve({ok:true,value:comparison(text)}));return {ok:true,value:comparison('initial text')};}
  throw Error('Unexpected workspace stability endpoint '+endpoint);
 };
 const Page=createPage({locale:{bind:()=>key=>key,subscribe:()=>()=>{},getSnapshot:()=>0},layout:{selectPanel:()=>{}},connection:{rpc:{call:rpc}}});
 const button=key=>[...host.querySelectorAll('button')].find(b=>b.textContent===key);
 try{
  root.render(<Page useSessions={select=>select({byId:{s:{id:'s',cwd:'/fixture',retainedBy:{mainView:1}}}})}/>);
  await wait(()=>host.textContent.includes('test authorization expired'),'show failed status after one retry');await frame();
  if(discoveries!==2||statusReads!==2||editorReads||host.querySelector('.monaco-diff-editor'))throw Error('Opening an empty workspace loaded Monaco or repeatedly rescanned');
  failStatus=false;button('refresh').click();await wait(()=>host.querySelector('.vcs-file'),'manual recovery');
  if(discoveries!==3||statusReads!==3||editorReads)throw Error('Idle workspace started Monaco or manual retry did not recover');
  host.querySelector('.vcs-file').click();await wait(()=>host.querySelector('.monaco-diff-editor')?.textContent.includes('initial text'),'first real comparison');
  const editor=host.querySelector('.monaco-diff-editor');
  button('comparisonFocus').click();await wait(()=>button('comparisonRestore'),'enter focus');
  for(let i=0;i<20;i++)focus();await wait(()=>completeStatus,'coalesced status');
  for(let i=0;i<20;i++)focus();await frame();
  if(statusReads!==4||compares!==1)throw Error('Focus storm queued or restarted work');
  completeStatus();await wait(()=>completeCompare,'refresh comparison despite unchanged status');await frame();
  if(host.querySelector('.monaco-diff-editor')!==editor||!editor.textContent.includes('initial text')||!button('comparisonRestore')||host.querySelector('.vcs-editorbox').dataset.hidden==='true')throw Error('Background refresh cleared or remounted the visible diff');
  completeCompare('updated text');await wait(()=>editor.textContent.includes('updated text'),'updated worktree text');
  completeStatus=null;focus();await wait(()=>completeStatus,'next independent status refresh');completeStatus([]);
  await wait(()=>!host.querySelector('.monaco-diff-editor')&&!button('comparisonRestore'),'removed file clears diff and focus');
  if(compares!==2||editorReads!==1)throw Error('Removed selection reloaded the editor or comparison');
 }finally{globalThis.fetch=fetcher;root.unmount();host.remove();}
}
