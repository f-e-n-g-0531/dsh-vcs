import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import SubmoduleBadge from '../src/SubmoduleBadge.jsx';
import locales from '../src/locales.json';
export async function checkSubmoduleBadge(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),oid='a1b2c3d4e5'.padEnd(40,'0');
 try{for(const lang of ['zh','en']){
  const t=k=>locales[lang][k];
  for(const state of ['initialized','uninitialized','absent','unreadable']){
   flushSync(()=>root.render(<SubmoduleBadge submodule={{recorded:oid,checkout:state}} t={t}/>));
   const badge=host.querySelector('.vcs-submodule');
   if(!badge)throw Error('Submodule badge missing for '+state);
   if(badge.getAttribute('data-checkout')!==state)throw Error('Submodule checkout state not exposed for '+state);
   if(!badge.textContent.includes(t('submoduleBadge'))||!badge.textContent.includes(oid.slice(0,10)))throw Error('Submodule badge label or pointer missing for '+state);
   if(badge.title!==oid+' · '+t('submoduleCheckout_'+state))throw Error('Submodule badge title lost the recorded pointer for '+state);
   if(badge.querySelector('img,script'))throw Error('Submodule badge injected markup');
  }
  flushSync(()=>root.render(<SubmoduleBadge submodule={undefined} t={t}/>));
  if(host.querySelector('.vcs-submodule'))throw Error('Absent metadata rendered a submodule badge');
  flushSync(()=>root.render(<SubmoduleBadge submodule={{recorded:'<img src=x onerror=alert(1)>'}} t={t}/>));
  if(host.querySelector('img'))throw Error('Submodule pointer text was interpreted as markup');
 }}finally{root.unmount();host.remove();}
}
