import React from 'react';
import {createRoot} from 'react-dom/client';
import HistoricalFile from '../src/HistoricalFile.jsx';
import locales from '../src/locales.json';
export async function checkRecovery(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),fetcher=globalThis.fetch,links=document.querySelectorAll('link').length;
 const wait=async fn=>{for(let i=0;i<400;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Recovery timeout '+host.textContent);};
 try{for(const lang of ['zh','en']){
 const t=k=>locales[lang][k]||k;let reads=0,fail=true;const urls=[];
 globalThis.fetch=(url,...args)=>{if(String(url).includes('vcs-assets/editor.js')){urls.push(String(url));if(fail){fail=false;return Promise.resolve(new Response('temporary',{status:503}));}}return fetcher(url,...args);};
 root.render(<HistoricalFile key={lang} sessionId="s" repositoryId="r" commit={'a'.repeat(40)} path="f.txt" t={t} onClose={()=>{}} onRediscover={()=>{throw Error('Unexpected rediscovery');}} rpc={async e=>{if(e!=='vcs/tree-file')throw Error(e);reads++;return {oid:'b'.repeat(40),text:'recovery text',encoding:'UTF-8'};}}/>);
 const retry=()=>[...host.querySelectorAll('button')].find(b=>b.textContent===t('retry'));
 await wait(()=>retry()&&host.textContent.includes('503'));if(!host.querySelector('.vcs-text-comparison'))throw Error('Fallback missing');retry().click();await wait(()=>host.querySelector('.monaco-editor')&&!retry());
 if(reads!==1||urls.length!==2||!urls[0].endsWith('retry=0')||!urls[1].endsWith('retry=1'))throw Error('Retry must change asset URL without reading body');
 root.render(null);await wait(()=>host.childNodes.length===0);
 }}finally{globalThis.fetch=fetcher;root.unmount();host.remove();}if(document.querySelectorAll('link').length!==links)throw Error('Stylesheet leak');
}
