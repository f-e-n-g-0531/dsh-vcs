import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import StashPanel from '../src/StashPanel.jsx';
export async function checkStashList(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const wait=async(fn,label)=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Stash timeout at '+label);};
 const id='a'.repeat(40),changeId='d'.repeat(64);
 const rpc=async(e,p,signal)=>{
  if(e==='vcs/stash-list')return {stashes:[{id,ref:'stash@{0}',message:'On main: wip'}]};
  if(e==='vcs/commit')return {id,subject:'On main: wip',author:'T',date:'2026-01-01T00:00:00Z',committer:'T',committerDate:'2026-01-01T00:00:00Z',parents:[],parent:null,message:'wip',changes:[{id:changeId,path:'f',status:'modified'}],signature:{signed:false,format:null}};
  if(e==='vcs/commit-compare')return {path:'f',left:{label:'parent',text:'before'},right:{label:'stash',text:'after'}};
  if(e==='vcs/file-history')return {path:'f',commits:[{id:'b'.repeat(40),subject:'earlier stash path',path:'f'}],nextOffset:null};
  if(e==='vcs/blame')return {lines:[{line:1,commit:'b'.repeat(40),author:'a',text:'source',summary:'earlier'}]};
  if(e==='vcs/tree')return {entries:[]};
  throw Error('Unexpected '+e);
 };
 const t=k=>k;
 const button=()=>[...host.querySelectorAll('button')].find(b=>b.textContent.includes('stash@{0}'));
 try{
  flushSync(()=>root.render(<StashPanel sessionId='s' repositoryId='r' rpc={rpc} t={t} onRediscover={()=>{}}/>));
  await wait(()=>button(),'stash-row');
  await wait(()=>host.textContent.includes('On main: wip'),'stash-message');
  button().click();
  await wait(()=>host.querySelector('[aria-label="commitDetails"]'),'commit-details');
  const byText=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
  byText('modified · f').click();await wait(()=>byText('fileHistory'),'stash comparison');byText('fileHistory').click();byText('blame').click();
  await wait(()=>host.textContent.includes('earlier stash path')&&host.querySelector('[aria-label=blame] tbody tr'),'readonly history');
  if(byText('earlier stash path')||host.querySelector('[aria-label=blame] tbody button[title]'))throw Error('Stash offers a no-op commit navigation button');
 }finally{root.unmount();host.remove();}
}