import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {apply} from '../src/client-bootstrap.jsx';
import dictionaries from '../src/locales.json';
export async function checkFrontendReload(){
 const host=document.createElement('div');host.style.cssText='height:720px;width:1100px';document.body.append(host);const root=createRoot(host),effects=[],calls=[];let Page,installs=0;
 const ctx={remote:{pluginManager:{installBundle:()=>{installs++;throw Error('Removed updater invoked');}}},effect:fn=>effects.push(fn),locale:{register:()=>()=>{},bind:()=>k=>dictionaries.zh[k]||k,subscribe:()=>()=>{},getSnapshot:()=>1},slots:{inject:(_s,fn)=>fn(),register:(spec,component)=>{if(spec.key==='local-vcs')Page=component;}},layout:{selectPanel(){}},connection:{rpc:{call:async(_r,e)=>{calls.push(e);if(e==='vcs/repositories')return {ok:true,value:{cwd:'/fixture',repositories:[]}};throw Error('Unexpected RPC '+e);}}}};
 try{apply(ctx);for(const fn of effects)fn();flushSync(()=>root.render(<Page useSessions={select=>select({byId:{s:{id:'s',cwd:'/fixture',retainedBy:{mainView:1}}}})}/>));
 for(let i=0;i<100&&!calls.length;i++)await new Promise(r=>setTimeout(r,20));
 if(!host.querySelector('.vcs-primary-toolbar')||!calls.includes('vcs/repositories'))throw Error('Bundled page did not mount');
 for(const key of ['updatePlugin','reloadInterface','branchSwitcher'])if([...host.querySelectorAll('button')].some(b=>b.textContent===dictionaries.zh[key]))throw Error('Removed control rendered: '+key);
 if(installs||calls.some(e=>e==='vcs/runtime-info'||e==='vcs/check-update'))throw Error('Removed updater performed work');
 }finally{root.unmount();host.remove();}
}
