import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import HistoryPanel from '../src/HistoryPanel.jsx';
import css from '../src/style.css';
import dictionaries from '../src/locales.json';
export async function checkHistoryLayout(){
 const host=document.createElement('div');host.className='vcs-root';host.style.cssText='height:720px;width:1100px;position:relative';document.body.append(host);
 const style=document.createElement('style');style.textContent=css;host.append(style);
 const mount=document.createElement('div');mount.style.cssText='display:flex;flex:1;min-height:0';host.append(mount);const root=createRoot(mount);
 const id='a'.repeat(40),parent='b'.repeat(40);
 const t=k=>dictionaries.zh[k]||k;
 const rpc=async(e)=>{
  if(e==='vcs/history')return {snapshot:id,nextOffset:null,commits:[{id,parents:[parent],subject:'整理历史面板与查询字段',author:'测试作者',date:'2026-10-12T12:00:00+08:00'}]};
  if(e==='vcs/commit')return {id,parents:[parent],parent,subject:'整理历史面板与查询字段',author:'测试作者',date:'2026-10-12T12:00:00+08:00',changes:[{id:'c'.repeat(64),status:'modified',path:'src/非常长的目录名称/HistoryPanel.jsx'}]};
  throw Error('Unexpected layout endpoint '+e);
 };
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('History layout timeout');};
 try{
  flushSync(()=>root.render(<HistoryPanel sessionId='layout' repositoryId='r' {...{rpc,t}} onRediscover={()=>{}}/>));
  await wait(()=>host.querySelector('.vcs-commit-row'));
  host.querySelector('.vcs-commit-row').click();await wait(()=>host.querySelector('.vcs-commit-files button'));
  for(const width of [1100,600,320]){
   host.style.width=width+'px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   for(const input of host.querySelectorAll('.vcs-history-search input')){
    const a=input.getBoundingClientRect(),b=input.closest('fieldset').getBoundingClientRect();
    if(a.left<b.left-1||a.right>b.right+1||a.width<20)throw Error('History input overflow at '+width);
   }
   const row=host.querySelector('.vcs-commit-files button'),list=row.parentElement.parentElement;
   if(row.getBoundingClientRect().width>list.getBoundingClientRect().width+1)throw Error('File row overflow at '+width+' row='+row.getBoundingClientRect().width+' list='+list.getBoundingClientRect().width);
  }
  if([...host.querySelectorAll('.vcs-help')].some(node=>node.open))throw Error('Help expanded by default');
  const help=host.querySelector('.vcs-help');help.querySelector('summary').click();if(!help.open)throw Error('Help cannot expand');
 }finally{root.unmount();host.remove();}
}
