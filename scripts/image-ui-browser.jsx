import React from 'react';
import {createRoot} from 'react-dom/client';
import ImageComparison from '../src/ImageComparison.jsx';
export async function checkImageUI(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Image UI timeout');};
 const base64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',calls=[],active=new Set();let mode='normal',pending=[],rediscovered=0;
 const create=URL.createObjectURL,revoke=URL.revokeObjectURL;
 URL.createObjectURL=b=>{const u=create.call(URL,b);active.add(u);return u;};URL.revokeObjectURL=u=>{if(!active.delete(u))throw Error('Image UI double revoke');revoke.call(URL,u);};
 const value=side=>({commit:'a'.repeat(40),path:side+'.png',mime:'image/png',base64,bytes:atob(base64).length,width:1,height:1,metadataStripped:true});
 const rpc=async(endpoint,p,signal)=>{if(endpoint!=='vcs/commit-image'||!['b'.repeat(64),'c'.repeat(64)].includes(p.id)||p.parentIndex!==1)throw Error('Wrong image request');calls.push({p,signal});if(mode==='pending')return new Promise(resolve=>pending.push(()=>resolve(value(p.side))));if(mode==='mixed'&&p.side==='left')throw Error('unsupported image');if(p.side==='left'){if(mode==='absent')return {commit:null,path:'left.png',absent:true};if(mode==='corrupt')return {...value(p.side),base64:btoa('broken'),bytes:6};if(mode==='expired')throw Object.assign(Error('expired'),{code:'vcs/rediscover-required'});}return value(p.side);};
 const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
 try{
 root.render(<ImageComparison sessionId="s" repositoryId="r" commit={'a'.repeat(40)} parentIndex={1} id={'b'.repeat(64)} rpc={rpc} t={k=>k} onRediscover={()=>{rediscovered++;}}/>);
 await wait(()=>button('imageCompare'));if(calls.length)throw Error('Images fetched before expansion');button('imageCompare').click();await wait(()=>host.querySelectorAll('img').length===2);
 if(active.size!==2||!host.textContent.includes('imageMetadata')||!host.textContent.includes('left.png'))throw Error('Image details missing');
 button('imageCompare').click();await wait(()=>active.size===0&&!host.querySelector('img'));if(calls.some(c=>!c.signal.aborted))throw Error('Image close did not cancel');
 mode='mixed';button('imageCompare').click();await wait(()=>host.querySelector('[role=alert]')&&host.querySelectorAll('img').length===1);mode='normal';button('retry').click();await wait(()=>host.querySelectorAll('img').length===2);button('imageCompare').click();await wait(()=>active.size===0);
 for(const scenario of ['absent','corrupt','expired']){
  mode=scenario;button('imageCompare').click();await wait(()=>host.querySelectorAll('img').length===1&&(scenario==='absent'?host.textContent.includes('imageAbsent'):host.querySelector('[role=alert]')));
  if(active.size!==1)throw Error('Failed or absent side retained object URL');if(scenario==='expired'&&rediscovered!==1)throw Error('Expired image did not trigger rediscovery');
  button('imageCompare').click();await wait(()=>active.size===0&&!host.querySelector('img'));
 }
 mode='pending';button('imageCompare').click();await wait(()=>pending.length===2);button('imageCompare').click();await wait(()=>calls.slice(-2).every(c=>c.signal.aborted));pending.forEach(done=>done());await new Promise(r=>setTimeout(r,30));if(active.size||host.querySelector('img'))throw Error('Late image response revived closed UI');
 pending=[];button('imageCompare').click();await wait(()=>pending.length===2);const old=calls.slice(-2),count=calls.length;
 root.render(<ImageComparison key="next-file" sessionId="s" repositoryId="r" commit={'a'.repeat(40)} parentIndex={1} id={'c'.repeat(64)} rpc={rpc} t={k=>k} onRediscover={()=>{rediscovered++;}}/>);
 await wait(()=>old.every(c=>c.signal.aborted)&&button('imageCompare')?.getAttribute('aria-expanded')==='false');pending.forEach(done=>done());await new Promise(r=>setTimeout(r,30));
 if(calls.length!==count||active.size||host.querySelector('img'))throw Error('File switch revived old images or fetched automatically');
 mode='normal';button('imageCompare').click();await wait(()=>host.querySelectorAll('img').length===2);if(calls.slice(-2).some(c=>c.p.id!=='c'.repeat(64)))throw Error('New file used old image identity');
 root.render(null);await wait(()=>active.size===0&&!host.querySelector('img'));if(calls.slice(-2).some(c=>!c.signal.aborted))throw Error('Unmount did not cancel new image requests');
 const pairCalls=[],base='d'.repeat(40),target='e'.repeat(40);
 const pairRpc=async(endpoint,p,signal)=>{if(endpoint!=='vcs/revision-image'||p.base!==base||p.target!==target||p.commit!==undefined||p.parentIndex!==undefined)throw Error('A/B image request wrong');pairCalls.push({p,signal});return value(p.side);};
 root.render(<ImageComparison key='pair' sessionId='s' repositoryId='r' {...{base,target}} id={'b'.repeat(64)} rpc={pairRpc} t={k=>k} onRediscover={()=>{}}/>);await wait(()=>button('imageCompare'));button('imageCompare').click();await wait(()=>host.querySelectorAll('img').length===2);if(pairCalls.length!==2||active.size!==2)throw Error('A/B images did not decode');
 button('imageCompare').click();await wait(()=>active.size===0);if(pairCalls.some(c=>!c.signal.aborted))throw Error('A/B close did not cancel');
 const workCalls=[],workRpc=async(endpoint,p,signal)=>{if(endpoint!=='vcs/workspace-image'||p.mode!=='unstaged'||p.commit!==undefined||p.base!==undefined)throw Error('Workspace image identity wrong');workCalls.push({p,signal});return value(p.side);};
 root.render(<ImageComparison key='workspace' workspace mode='unstaged' sessionId='s' repositoryId='r' id={'b'.repeat(64)} rpc={workRpc} t={k=>k} onRediscover={()=>{}}/>);await wait(()=>button('imageCompare'));button('imageCompare').click();await wait(()=>host.querySelectorAll('img').length===2);if(active.size!==2||workCalls.length!==2)throw Error('Workspace PNG decode failed');root.render(null);await wait(()=>active.size===0);if(workCalls.some(c=>!c.signal.aborted))throw Error('Workspace image unmount did not cancel');
 }finally{root.unmount();host.remove();URL.createObjectURL=create;URL.revokeObjectURL=revoke;for(const u of active)revoke.call(URL,u);}
}
