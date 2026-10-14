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
  if(e==='vcs/commit')return {id,parents:[parent],parent,subject:'整理历史面板与查询字段',author:'测试作者',date:'2026-10-12T12:00:00+08:00',changes:Array.from({length:120},(_,i)=>({id:i.toString(16).padStart(64,'0'),status:'modified',path:'src/非常长的目录名称/file-'+i+'.jsx'}))};
  if(e==='vcs/commit-compare')return {path:'selected-file.jsx',left:{label:'parent',text:Array.from({length:200},(_,i)=>'before '+i).join('\n')},right:{label:'commit',text:Array.from({length:200},(_,i)=>'after '+i).join('\n')}};
   throw Error('Unexpected layout endpoint '+e);
 };
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('History layout timeout');};
 try{
  flushSync(()=>root.render(<HistoryPanel sessionId='layout' repositoryId='r' {...{rpc,t}} onRediscover={()=>{}}/>));
  await wait(()=>host.querySelector('.vcs-commit-row'));
  if(host.querySelector('.vcs-history-search'))throw Error('Advanced search still occupies history browsing');
   host.querySelector('.vcs-commit-row').click();await wait(()=>host.querySelector('.vcs-commit-files button'));
  const buttons=[...host.querySelectorAll('.vcs-commit-files button')];
  buttons.at(-1).click();await wait(()=>host.querySelector('.vcs-commit-comparison .monaco-diff-editor'));
  for(const width of [1100,600,320]){
   host.style.width=width+'px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   for(const input of host.querySelectorAll('.vcs-history-search input')){
    const a=input.getBoundingClientRect(),b=input.closest('fieldset').getBoundingClientRect();
    if(a.left<b.left-1||a.right>b.right+1||a.width<20)throw Error('History input overflow at '+width);
   }
   const panel=host.querySelector('.vcs-history-details').getBoundingClientRect();
   const comparison=host.querySelector('.vcs-commit-comparison').getBoundingClientRect();
   if(comparison.height<80||comparison.top<panel.top-1||comparison.bottom>panel.bottom+1)throw Error('Comparison not visible with 120 files at '+width);
   const picker=host.querySelector('.vcs-commit-picker');picker.scrollTop=picker.scrollHeight;
   if(Math.abs(host.querySelector('.vcs-commit-comparison').getBoundingClientRect().top-comparison.top)>1)throw Error('File scroll moved Diff');
   const row=host.querySelector('.vcs-commit-files button'),list=row.parentElement.parentElement;
   if(row.getBoundingClientRect().width>list.getBoundingClientRect().width+1)throw Error('File row overflow at '+width+' row='+row.getBoundingClientRect().width+' list='+list.getBoundingClientRect().width);
  }
  host.style.width='1400px';host.style.height='950px';await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const editor=host.querySelector('.vcs-history-editor-host'),before=editor.getBoundingClientRect();
  if(before.height<=360)throw Error('Editor did not grow beyond old fixed height: '+before.height);
  host.querySelector('.vcs-comparison-focus').click();await wait(()=>host.querySelector('.vcs-commit-focused'));
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const focused=editor.getBoundingClientRect();
  if(focused.width<=before.width||focused.height<=before.height)throw Error('Focus did not enlarge editor');
  if(getComputedStyle(host.querySelector('.vcs-commit-picker')).display!=='none')throw Error('Focus did not hide file picker');
  host.querySelector('.vcs-comparison-focus').click();await wait(()=>!host.querySelector('.vcs-commit-focused'));
  if([...host.querySelectorAll('.vcs-help')].some(node=>node.open))throw Error('Help expanded by default');
  const help=host.querySelector('.vcs-help');help.querySelector('summary').click();if(!help.open)throw Error('Help cannot expand');
 }finally{root.unmount();host.remove();}
}
