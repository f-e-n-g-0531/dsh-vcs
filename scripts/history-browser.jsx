import React from 'react';
import {createRoot} from 'react-dom/client';
import HistoryPanel from '../src/HistoryPanel.jsx';
const calls=[],a='a'.repeat(40),b='b'.repeat(40),id='c'.repeat(64);
const row=(id,subject)=>({id,subject,author:'Tester',date:'2026-09-29T00:00:00+00:00',parents:[]});
const rpc=async(endpoint,payload)=>{
 calls.push({endpoint,payload});
 if(endpoint==='vcs/history')return {snapshot:a,commits:payload.offset?[row(b,'Second commit')]:[row(a,'First commit')],nextOffset:payload.offset?null:1};
 if(endpoint==='vcs/commit')return {...row(payload.commit,'Details'),parent:null,parentIndex:0,changes:[{id,path:'example.txt',status:'added'}]};
 if(endpoint==='vcs/commit-compare')return {path:'example.txt',left:{label:'Empty',text:''},right:{label:a,text:'historical content'},binary:false};
 throw Error('Unexpected RPC');
};
const root=createRoot(document.querySelector('#root'));
root.render(<HistoryPanel sessionId="fixture" repositoryId="repo" rpc={rpc} t={key=>key} onRediscover={()=>{throw Error('Unexpected rediscovery');}}/>);
const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out waiting for UI');};
const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text);
(async()=>{try{
 await wait(()=>button('First commit'));
 button('historyMore').click();await wait(()=>button('Second commit'));
 if(calls[1].payload.snapshot!==a||calls[1].payload.offset!==1)throw Error('Snapshot pagination mismatch');
 button('First commit').click();await wait(()=>button('added · example.txt'));
 button('added · example.txt').click();await wait(()=>document.querySelector('.vcs-text-comparison'));
 if(!document.querySelector('.vcs-text-comparison').textContent.includes('historical content'))throw Error('Missing historical content');
 document.querySelector('#report').textContent=JSON.stringify({pass:true,browser:navigator.userAgent,steps:['pagination','commit','file','diff'],calls:calls.length});
 }catch(e){document.querySelector('#report').textContent=JSON.stringify({pass:false,error:String(e)});}})();
