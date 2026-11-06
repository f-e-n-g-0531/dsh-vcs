import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
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
 const zoom=host.querySelector('select'),images=()=>[...host.querySelectorAll('img')],regions=()=>[...host.querySelectorAll('[role=region]')];
 if(!host.querySelector('[role=group][aria-label="imageScale"]')||zoom?.closest('label')?.textContent.indexOf('imageZoom')!==0||zoom.value!=='fit'||button('imageFit')?.getAttribute('aria-pressed')!=='true'||button('imageActualSize')?.getAttribute('aria-pressed')!=='false')throw Error('Image scale controls missing accessible defaults');
 if([...zoom.options].map(o=>o.value).join(',')!=='fit,25,50,100,200')throw Error('Image zoom options not bounded');
 if(images().some(img=>img.style.width||img.style.maxWidth!=='100%'||img.style.maxHeight!=='480px')||regions().length!==2||regions().some(region=>region.tabIndex!==0||!region.getAttribute('aria-label')?.includes('imageViewport')||getComputedStyle(region).overflow!=='auto'))throw Error('Default fit or keyboard scroll container changed');
 const scaleCalls=calls.length,urls=images().map(img=>img.src).join(',');
 for(const percent of [25,50,100,200]){zoom.value=String(percent);zoom.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>images().every(img=>img.style.width===percent/100+'px'&&img.style.height===percent/100+'px'));if(images().some(img=>img.style.maxWidth!=='none'||img.style.maxHeight!=='none'))throw Error('Numeric zoom fitted down');}
 button('imageActualSize').click();await wait(()=>zoom.value==='100'&&button('imageActualSize').getAttribute('aria-pressed')==='true');
 button('imageFit').click();await wait(()=>zoom.value==='fit'&&images().every(img=>img.style.maxWidth==='100%'&&!img.style.width));
 if(calls.length!==scaleCalls||active.size!==2||images().map(img=>img.src).join(',')!==urls)throw Error('Scale change refetched or replaced image resources');
 for(const mode of ['imageOverlay','imageSwipe']){button(mode).click();await wait(()=>host.querySelector('[data-image-canvas]'));const range=host.querySelector('input[type=range]');if(!range||range.min!=='0'||range.max!=='100')throw Error('Composite range inaccessible');for(const value of ['0','100']){range.value=value;range.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>range.value===value);}if(calls.length!==scaleCalls||active.size!==2)throw Error('Composite mode refetched resource');}
 button('imageSideBySide').click();await wait(()=>!host.querySelector('[data-image-canvas]'));
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
 flushSync(()=>root.render(<ImageComparison key='workspace' workspace mode='unstaged' sessionId='s' repositoryId='r' id={'b'.repeat(64)} rpc={workRpc} t={k=>k} onRediscover={()=>{}}/>));await wait(()=>button('imageCompare'));button('imageCompare').click();await wait(()=>host.querySelectorAll('img').length===2);if(active.size!==2||workCalls.length!==2)throw Error('Workspace PNG decode failed');root.render(null);await wait(()=>active.size===0);if(workCalls.some(c=>!c.signal.aborted))throw Error('Workspace image unmount did not cancel');
 // Real decoded, unequal dimensions: assertions below measure browser layout/computed CSS.
 host.style.width='620px';
 const largeCalls=[],sizes={left:[700,600],right:[350,300]},payloads={};
 for(const side of ['left','right']){const canvas=document.createElement('canvas');[canvas.width,canvas.height]=sizes[side];payloads[side]=canvas.toDataURL('image/png').split(',')[1];}
 const largeRpc=async(endpoint,p,signal)=>{largeCalls.push({p,signal});const base64=payloads[p.side],[width,height]=sizes[p.side];return {...value(p.side),base64,bytes:atob(base64).length,width,height};};
 root.render(<ImageComparison key='large-scale' sessionId='s' repositoryId='r' commit={'a'.repeat(40)} parentIndex={1} id={'b'.repeat(64)} rpc={largeRpc} t={k=>k} onRediscover={()=>{}}/>);
 await wait(()=>button('imageCompare'));button('imageCompare').click();await wait(()=>images().length===2&&images().every(img=>img.complete&&img.naturalWidth));
 const near=(actual,expected)=>Math.abs(actual-expected)<=0.75;
 const largeURLs=new Set(images().map(img=>img.src));
 const assertResources=()=>{if(largeCalls.length!==2||active.size!==2||largeURLs.size!==2||images().some(img=>!largeURLs.has(img.src))||[...largeURLs].some(url=>!active.has(url)))throw Error('Mode/zoom changed the two RPCs or two active image URLs');};
 const assertSizes=percent=>images().every((img,index)=>{const [width,height]=sizes[index?'right':'left'],box=img.getBoundingClientRect();return near(box.width,width*percent/100)&&near(box.height,height*percent/100);});
 if(images().some(img=>img.getBoundingClientRect().width>img.parentElement.clientWidth+0.75||img.getBoundingClientRect().height>480.75))throw Error('Fit exceeded preview bounds');
 button('imageActualSize').click();await wait(()=>assertSizes(100));
 const leftRegion=regions()[0];if(leftRegion.scrollWidth<=leftRegion.clientWidth||leftRegion.scrollHeight<=leftRegion.clientHeight||leftRegion.clientHeight>480)throw Error('Actual size is not scrollable on both axes');
 const largeZoom=host.querySelector('select');
 const setZoom=async percent=>{largeZoom.value=String(percent);largeZoom.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>largeZoom.value===String(percent));};
 await setZoom(200);await wait(()=>assertSizes(200));assertResources();
 // Native value setter bypasses React's input tracker. These are programmatic
 // input/change events, NOT real keyboard events or browser key default actions.
 const setRange=async value=>{const range=host.querySelector('input[type=range]');if(!range||range.min!=='0'||range.max!=='100')throw Error('Composite range inaccessible');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(range,String(value));range.dispatchEvent(new Event('input',{bubbles:true}));range.dispatchEvent(new Event('change',{bubbles:true}));await wait(()=>range.parentElement.querySelector('output')?.textContent===value+'%');};
 for(const presentation of ['imageOverlay','imageSwipe']){
  button(presentation).click();await wait(()=>button(presentation).getAttribute('aria-pressed')==='true'&&host.querySelector('[data-image-canvas]'));
  const canvas=host.querySelector('[data-image-canvas]'),viewport=canvas.parentElement,compositeImages=()=>[...canvas.querySelectorAll('img')];
  const assertGeometry=percent=>{const box=canvas.getBoundingClientRect(),[left,right]=compositeImages().map(img=>img.getBoundingClientRect());
   if(!left||!right||Math.abs(left.width/right.width-2)>0.01||Math.abs(left.height/right.height-2)>0.01||!near(left.x,right.x)||!near(left.y,right.y)||!near(left.x,box.x)||!near(left.y,box.y)||!near(left.width,box.width)||!near(left.height,box.height))throw Error('Composite images lost shared top-left or 2:1 bounding-box ratio');
   if(percent!==undefined&&(!near(box.width,700*percent/100)||!near(box.height,600*percent/100)||!near(right.width,350*percent/100)||!near(right.height,300*percent/100)))throw Error('Composite numeric zoom did not preserve natural pixel scale');
   assertResources();return {box,left,right};
  };
  for(const width of [620,320,1000]){host.style.width=width+'px';button('imageFit').click();await wait(()=>largeZoom.value==='fit');const {box}=assertGeometry();const expected=Math.min(viewport.clientWidth,700,480*700/600);
   if(!near(box.width,expected)||box.width>host.clientWidth+0.75||box.height>480.75||box.width>700.75||box.height>600.75)throw Error('Composite fit exceeded host/480 bounds or upscaled');
  }
  host.style.width='620px';
  for(const percent of [100,200]){
   await setZoom(percent);await wait(()=>near(canvas.getBoundingClientRect().width,700*percent/100));assertGeometry(percent);
   if(viewport.scrollWidth<700*percent/100||viewport.scrollHeight<600*percent/100||viewport.clientHeight>480)throw Error('Composite numeric zoom lost scroll extent');
   if(presentation==='imageOverlay')for(const opacity of [0,100]){await setRange(opacity);if(Number(getComputedStyle(compositeImages()[1]).opacity)!==opacity/100)throw Error('Overlay computed opacity endpoint wrong');assertGeometry(percent);}
   else for(const split of [0,25,50,100]){
    await setRange(split);const {box,right}=assertGeometry(percent),clip=getComputedStyle(compositeImages()[1]).clipPath;
    const match=/^inset\(([^)]+)\)$/.exec(clip),parts=match?.[1].trim().split(/\s+/);if(!parts||!parts.length)throw Error('Swipe computed clip is not an inset');
    const inset=parts[1]??parts[0],rightInset=parseFloat(inset)*(inset.endsWith('%')?right.width/100:1),visibleWidth=right.width-rightInset,expected=Math.min(right.width,box.width*split/100);
    if(!Number.isFinite(visibleWidth)||!near(visibleWidth,expected)||(split>=50&&!near(visibleWidth,right.width)))throw Error('Swipe clip did not use shared canvas width (small right must be fully visible by 50%)');
   }
  }
 }
 button('imageSideBySide').click();await wait(()=>!host.querySelector('[data-image-canvas]'));assertResources();
 button('imageFit').click();await wait(()=>largeZoom.value==='fit');assertResources();
 root.render(null);await wait(()=>active.size===0&&!host.querySelector('img'));if(largeCalls.length!==2||largeCalls.some(c=>!c.signal.aborted))throw Error('Scaled image unmount did not cancel/clean resources');
 }finally{root.unmount();host.remove();URL.createObjectURL=create;URL.revokeObjectURL=revoke;for(const u of active)revoke.call(URL,u);}
}
