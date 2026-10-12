import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import CommitDetails from '../src/CommitDetails.jsx';
export async function checkCommitCommitter(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const wait=async(fn,label)=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Commit committer timeout at '+label);};
 const A='a'.repeat(40),changeId='d'.repeat(64);
 const rpc=async(e,p,signal)=>{
  if(e==='vcs/commit')return {id:p.commit,subject:'Mixed identity',author:'Author',date:'2026-01-01T00:00:00Z',committer:'Committer',committerDate:'2026-01-02T00:00:00Z',parents:[],parent:null,message:'m',changes:[{id:changeId,path:'f',status:'modified'}],signature:{signed:false,format:null}};
  if(e==='vcs/tree')return {entries:[]};
  throw Error('Unexpected '+e);
 };
 const t=k=>k;
 try{
  flushSync(()=>root.render(<CommitDetails sessionId='s' repositoryId='r' commit={A} rpc={rpc} t={t} onRediscover={()=>{}} onSelectCommit={()=>{}}/>));
  await wait(()=>host.textContent.includes('commitCommitter'),'committer-line');
  if(!host.textContent.includes('Committer'))throw Error('Committer name missing');
  if(!host.textContent.includes('Author'))throw Error('Author line missing');
 }finally{root.unmount();host.remove();}
}