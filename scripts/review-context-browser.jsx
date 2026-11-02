import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import HistoryPanel from '../src/HistoryPanel.jsx';
export async function checkReviewContext(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const A='a'.repeat(40),B='b'.repeat(40),P='c'.repeat(40),id='d'.repeat(64),path='中文 file.txt',calls=[];
 const wait=async(fn,label)=>{for(let i=0;i<600;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Review context timeout: '+label);};
 const t=k=>k,button=s=>[...host.querySelectorAll('button')].find(b=>b.textContent===s),h3=()=>host.querySelector('[aria-label=commitDetails] h3')?.textContent;
 const rpc=async(e,p)=>{calls.push({e,p});
  if(e==='vcs/references')return {references:[]};
  if(e==='vcs/history')return {snapshot:A,nextOffset:null,commits:[{id:A,subject:'commit A',parents:[P,B],author:'a',date:'2026-01-01'}]};
  if(e==='vcs/commit')return {id:p.commit,subject:p.commit===A?'commit A':'commit B',author:'a',date:'2026-01-01',parents:p.commit===A?[P,B]:[],parent:p.commit===A?[P,B][p.parentIndex]:null,changes:[{id,path,status:'modified'}]};
  if(e==='vcs/commit-compare')return {path,left:{label:'Parent',text:'before'},right:{label:'Commit',text:'after'},notice:'old text 2 MiB',preview:{canLoadLarge:false,reason:null,complete:true}};
  if(e==='vcs/file-history')return {path,nextOffset:null,commits:[{id:B,path,subject:'jump B',author:'a',date:'2026-01-01'}]};
  if(e==='vcs/blame')return {startLine:1,nextLine:null,totalLines:1,lines:[{line:1,originalLine:3,commit:B,path,author:'a',text:'origin',summary:'summary'}]};
  if(e==='vcs/tree-page')return {commit:p.commit,path:p.path,entries:[{path:'side-only.txt',mode:'100644',type:'blob',oid:P}],nextOffset:null};
  if(e==='vcs/tree-history')return {path:p.path,nextOffset:null,commits:[{id:p.path==='side-only.txt'?B:A,path:p.path,subject:p.path==='side-only.txt'?'tree jump B':'path jump A',author:'a',date:'2026-01-01'}]};
  if(e==='vcs/tree-file')return {oid:P,encoding:'UTF-8',text:'one\ntwo\norigin'};
  throw Error('Unexpected review context endpoint '+e);
 };
 try{
  flushSync(()=>root.render(<HistoryPanel sessionId='review' repositoryId='r' {...{rpc,t}} onRediscover={()=>{}}/>));
  await wait(()=>button('commit A'),'history');button('commit A').click();await wait(()=>host.querySelector('[aria-label=commitParent]'),'parents');
  const select=host.querySelector('[aria-label=commitParent]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'1');select.dispatchEvent(new Event('change',{bubbles:true}));
  await wait(()=>calls.some(c=>c.e==='vcs/commit'&&c.p.parentIndex===1)&&button('modified · '+path),'second parent');button('modified · '+path).click();
  await wait(()=>button('historyBasic')&&host.querySelector('.monaco-diff-editor'),'comparison');if(button('largeLoad'))throw Error('Structured false capability ignored');button('historyBasic').click();await wait(()=>button('historyAdvanced'),'basic mode');
  const focus=host.querySelector('.vcs-comparison-focus');focus.click();button('fileHistory').click();await wait(()=>button('jump B'),'file history');button('jump B').click();await wait(()=>h3()==='commit B','jump B');
  [...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='historyNavigationBack').click();
  await wait(()=>h3()==='commit A'&&host.querySelector('[aria-label=commitParent]')?.value==='1'&&button('historyAdvanced'),'restore parent and basic');
  if(!host.querySelector('.vcs-commit-focused')||!host.querySelector('.vcs-commit-files button[aria-pressed=true]')?.textContent.includes(path))throw Error('File/focus context not restored');
  button('blame').click();await wait(()=>host.querySelector('table button[title="'+B+'"]'),'blame');host.querySelector('table button[title="'+B+'"]').click();
  await wait(()=>h3()==='commit B'&&host.querySelector('[aria-label=treePreview]'),'line destination');if(!host.textContent.includes('blameOriginLine: 3'))throw Error('Blame origin line lost');
  button('pathHistory').click();await wait(()=>button('path jump A'),'origin path history');button('path jump A').click();await wait(()=>h3()==='commit A','second jump');
  [...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='historyNavigationBack').click();await wait(()=>h3()==='commit B'&&host.textContent.includes('blameOriginLine: 3')&&host.querySelector('.selected-text'),'restore original line');
  [...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='historyNavigationBack').click();await wait(()=>h3()==='commit A'&&host.querySelector('[aria-label=commitParent]')?.value==='1','return from line');
  // A tree file outside changes must restore alongside, not replace the main comparison.
  host.querySelector('.vcs-comparison-focus').click();button('historicalTree').click();await wait(()=>button('side-only.txt'),'side tree file');button('side-only.txt').click();await wait(()=>host.querySelector('[aria-label=treePreview]'),'tree preview');
  const treePreview=host.querySelector('[aria-label=treePreview]');[...treePreview.querySelectorAll('button')].find(b=>b.textContent==='pathHistory').click();await wait(()=>button('tree jump B'),'tree history');button('tree jump B').click();await wait(()=>h3()==='commit B','tree jump');
  [...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='historyNavigationBack').click();await wait(()=>h3()==='commit A'&&host.querySelector('[aria-label=treePreview] h4')?.textContent==='side-only.txt','restore tree side preview');
  if(host.querySelector('[aria-label=commitParent]')?.value!=='1'||!host.querySelector('.vcs-commit-files button[aria-pressed=true]')?.textContent.includes(path))throw Error('Tree overwrote main parent/path');
  // Close tree, then use the separate inline Blame origin preview rather than commit link.
  button('historicalTree').click();await wait(()=>button('blame'),'main blame restored');button('blame').click();await wait(()=>button('blameOriginLine: '+path+':3'),'inline origin');button('blameOriginLine: '+path+':3').click();await wait(()=>host.querySelector('[aria-label=treePreview]'),'inline origin preview');
  const originPreview=host.querySelector('[aria-label=treePreview]');[...originPreview.querySelectorAll('button')].find(b=>b.textContent==='pathHistory').click();await wait(()=>button('path jump A'),'inline origin path history');button('path jump A').click();await wait(()=>!host.querySelector('[aria-label=treePreview]'),'inline origin jump');
  [...host.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='historyNavigationBack').click();await wait(()=>host.querySelector('[aria-label=blame] [aria-label=treePreview]')&&host.textContent.includes('blameOriginLine: 3')&&host.querySelector('.selected-text'),'restore inline origin line');
  if(host.querySelector('[aria-label=commitParent]')?.value!=='1')throw Error('Blame origin overwrote merge parent');
 }finally{root.unmount();host.remove();}
}
