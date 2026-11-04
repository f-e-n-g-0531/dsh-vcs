import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import GrepPanel from '../src/GrepPanel.jsx';
export async function checkSearchNavigation(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const wait=async(fn,label)=>{for(let i=0;i<600;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Search navigation timeout: '+label);};
 const A='a'.repeat(40),B='b'.repeat(40),oid='c'.repeat(40),path=' spaced 中文 %2F.txt';let head=A,pending,oldSignal;
 const reads=[],segments=[];
 const rpc=async(e,p,signal)=>{
  if(e==='vcs/grep'){if(p.query==='late'){oldSignal=signal;return new Promise(resolve=>pending=resolve);}if(p.cursor){if(p.commit!==A||p.query!=='pinned')throw Error('Search page lost snapshot/query');return {snapshot:A,matches:[{path,line:2500,text:'deep hit'}],complete:true,nextCursor:null};}return {snapshot:p.commit||head,matches:[{path,line:3,text:'pinned hit'}],complete:false,nextCursor:'next'};}
  if(e==='vcs/tree-history')return {path,nextOffset:null,commits:[{id:B,path,subject:'earlier version',author:'a',date:'2026-01-01'}]};
  if(e==='vcs/tree-file'){reads.push(p);if(![A,B].includes(p.commit)||p.path!==path)throw Error('Search opened mutable version');return {commit:p.commit,path,oid,encoding:'UTF-8',text:Array.from({length:3000},(_,i)=>i===2?'pinned hit':i===2499?'deep hit':'line '+(i+1)).join('\n')};}
  if(e==='vcs/tree-segment'){segments.push(p);if(p.line!==2500||p.offset!==undefined||p.commit!==A)throw Error('Segment target lost identity');return {commit:A,path,oid,text:'deep hit\nfollowing',encoding:'UTF-8',offset:40000,endOffset:40018,totalBytes:50000,nextOffset:40018,startLine:2500,endLine:2501,startsMidLine:false,endsMidLine:true,targetFound:true};}
  throw Error('Unexpected search navigation endpoint '+e);
 };
 const t=k=>k,button=s=>[...host.querySelectorAll('button')].find(b=>b.textContent===s);
 const inputValue=async value=>{const input=host.querySelector('[aria-label=grepQuery]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>!host.querySelector('button[type=submit]').disabled,'submit enabled');};
 try{
  flushSync(()=>root.render(<GrepPanel sessionId='search' repositoryId='r' {...{rpc,t}} onRediscover={()=>{throw Error('Unexpected rediscover');}}/>));
  await inputValue('pinned');host.querySelector('button[type=submit]').click();await wait(()=>button(path+':3'),'search hit');head=B;
  button(path+':3').click();await wait(()=>reads.length&&host.querySelector('.monaco-editor'),'fixed file preview');
  await wait(()=>host.querySelector('.selected-text'),'line location');
  if(!host.textContent.includes(A)||host.querySelector('[aria-label=treePreview] h4')?.textContent!==path)throw Error('Pinned file identity missing');
  if(reads[0].commit!==A)throw Error('Search did not pin original snapshot');
  button('pathHistory').click();await wait(()=>button('earlier version'),'search path history');button('earlier version').click();await wait(()=>reads.at(-1)?.commit===B,'path history destination');
  button('historyBack').click();await wait(()=>reads.at(-1)?.commit===A&&host.querySelector('.selected-text'),'return search origin line');
  button('historyBack').click();await wait(()=>button(path+':3'),'back to results');
  if(host.querySelector('[aria-label=grepQuery]').value!=='pinned'||reads.length!==3)throw Error('Search query/result not restored');
  button('grepNextPage').click();await wait(()=>button(path+':2500'),'pinned continuation page');button(path+':2500').click();await wait(()=>host.querySelector('.monaco-editor'),'deep advanced preview');
  button('historyBasic').click();await wait(()=>host.querySelector('[data-line="2500"][data-target]'),'basic deep target');
  if(host.querySelectorAll('.vcs-single-file [data-line]').length>500)throw Error('Basic reading window is unbounded');
  button('segments').click();await wait(()=>segments.length&&host.querySelectorAll('[data-line="2500"][data-target]').length===2,'located segment basic');
  if(!host.textContent.includes('segmentPartialLine'))throw Error('Segment partial-line boundary missing');
  const segmentAdvanced=[...host.querySelectorAll('button')].filter(b=>b.textContent==='historyAdvanced').at(-1);segmentAdvanced.click();
  await wait(()=>[...host.querySelectorAll('.line-numbers')].some(n=>n.textContent==='2500'),'Monaco global segment line number');
  button('historyBasic').click();await wait(()=>host.querySelectorAll('[data-line="2500"][data-target]').length===2,'segment basic restored');
  button('pathHistory').click();await wait(()=>button('earlier version'),'deep file history');button('earlier version').click();await wait(()=>reads.at(-1)?.commit===B,'deep source');
  button('historyBack').click();await wait(()=>host.querySelector('[data-line="2500"][data-target]'),'restore basic setting and target');
  button('historyBack').click();await wait(()=>button(path+':2500'),'restore continuation results');button('grepPreviousPage').click();await wait(()=>button(path+':3'),'previous pinned search page');
  await inputValue('late');host.querySelector('button[type=submit]').click();await wait(()=>pending,'late request');
  flushSync(()=>root.render(<GrepPanel sessionId='other' repositoryId='r' {...{rpc,t}} onRediscover={()=>{}}/>));
  if(!oldSignal.aborted)throw Error('Search scope did not abort');pending({snapshot:A,matches:[{path:'STALE',line:1,text:'old'}]});
  await new Promise(r=>setTimeout(r,40));if(host.textContent.includes('STALE')||host.querySelector('input').value!=='')throw Error('Late search crossed scope');
 }finally{root.unmount();host.remove();}
}
