import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createPage,dictionaries} from '../src/client.jsx';
const wait=async f=>{for(let i=0;i<200;i++){if(f())return;await new Promise(r=>setTimeout(r,10));}throw Error('Snapshot layout timeout');};
export async function checkSnapshotLayout(){
 for(const lang of ['zh','en'])for(const [width,height] of [[1346,900],[600,480],[320,480]])for(const view of ['reflog','stash']){
 const host=document.createElement('div');host.style.cssText='width:'+width+'px;height:'+height+'px';document.body.append(host);const root=createRoot(host),calls=[],id='a'.repeat(40),t=k=>dictionaries[lang][k]||k;
 const rpc=async(e,p)=>{calls.push(e);if(e==='vcs/repositories')return {cwd:'/fixture',repositories:[{id:'r',type:'git',root:'/fixture'}]};if(e==='vcs/status')return {changes:[]};if(e==='vcs/reflog')return {entries:Array.from({length:200},(_,i)=>({id,selector:'HEAD@{'+i+'}',message:'long message '.repeat(12),date:'2026-11-17'})),truncated:false};if(e==='vcs/stash-list')return {stashes:Array.from({length:200},(_,i)=>({id:i.toString(16).padStart(40,'0'),ref:'stash@{'+i+'}',message:'long message '.repeat(12)}))};if(e==='vcs/commit')return {id:p.commit,subject:'Snapshot details',author:'Fixture',date:'2026-11-17',parents:[],changes:[]};throw Error(e);};
 const ctx={locale:{bind:()=>t,subscribe:()=>()=>{},getSnapshot:()=>lang},layout:{selectPanel(){}},connection:{rpc:{call:async(_r,e,p)=>({ok:true,value:await rpc(e,p)})}}};
 const Page=createPage(ctx,{initialView:view});const box=n=>n.getBoundingClientRect();const assert=(v,m)=>{if(!v)throw Error(lang+' '+width+' '+view+' '+m);};
 try{flushSync(()=>root.render(<Page useSessions={select=>select({byId:{s:{id:'s',cwd:'/fixture',retainedBy:{mainView:1}}}})}/>));await wait(()=>host.querySelector('.vcs-snapshot-list li button'));const page=host.querySelector('.vcs-root'),toolbar=host.querySelector('.vcs-primary-toolbar'),list=host.querySelector('.vcs-snapshot-list');
 list.querySelector('button').click();await wait(()=>host.querySelector('.vcs-commit-detail-tabs'));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const details=host.querySelector('.vcs-snapshot-details'),tabs=host.querySelector('.vcs-commit-detail-tabs');
 if(view==='reflog'){const date=list.querySelector('.vcs-snapshot-date');assert(date&&box(date).height>0,'date hidden');}
 assert(box(toolbar).height>=40&&box(toolbar).top>=box(page).top-1,'toolbar collapsed');for(const b of toolbar.querySelectorAll('button'))assert(box(b).bottom<=box(toolbar).bottom+1,'toolbar button clipped');assert(box(details).height>=100&&box(details).bottom<=box(page).bottom+1,'detail clipped');assert(box(tabs).bottom<=box(details).bottom+1,'tabs clipped');assert(list.scrollHeight>list.clientHeight,'list unbounded');const top=box(details).top;list.scrollTop=list.scrollHeight;assert(list.scrollTop>0&&Math.abs(box(details).top-top)<1,'scroll moves details');const count=calls.length;tabs.querySelector('button').click();await wait(()=>!host.querySelector('.vcs-commit-summary').hidden);tabs.querySelectorAll('button')[1].click();await wait(()=>!host.querySelector('.vcs-commit-picker').hidden);assert(calls.length===count,'tab RPC');
 }finally{root.unmount();host.remove();}
 }
}
