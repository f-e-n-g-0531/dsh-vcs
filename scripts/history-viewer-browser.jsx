import React from 'react';
export {checkSvnHistory,checkRealSvnHistory} from './svn-history-browser.jsx';
export {checkSvnConsent} from './svn-consent-browser.jsx';
export {checkSvnIdentity} from './svn-identity-browser.jsx';
export {checkHistoryWindow} from './history-window-browser.jsx';
export {checkSegments} from './segments-browser.jsx';
export {checkJpegDecode,checkPreparedJpeg,checkJpegComparison,checkLosslessWebp,checkPreparedWebp} from './jpeg-browser.jsx';
export {checkBlameLocation} from './blame-location-browser.jsx';
export {checkFollowHistory} from './follow-history-browser.jsx';
export {checkBranchHistory} from './branch-history-browser.jsx';
export {checkHistorySearch} from './history-search-browser.jsx';
export {checkReviewViews} from './review-views-browser.jsx';
export {checkHistoryRefs} from './history-refs-browser.jsx';
export {checkImageUI} from './image-ui-browser.jsx';
export {checkImage} from './image-browser.mjs';
export {checkGraph} from './graph-browser.jsx';
export {checkTree} from './tree-browser.jsx';
export {checkBlame} from './blame-browser.jsx';
export {checkFileHistory} from './file-history-browser.jsx';
export {checkRevisions} from './revision-browser.jsx';
import {createRoot} from 'react-dom/client';
import HistoryViewer from '../src/HistoryViewer.jsx';
export async function checkViewer(){
 const host=document.createElement('div');host.style.width='900px';document.body.appendChild(host);
 const root=createRoot(host),initial=globalThis.MonacoEnvironment;
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('History viewer UI timeout');};
 const button=text=>[...host.querySelectorAll('button')].find(b=>b.textContent===text);
 try{
 root.render(<HistoryViewer comparison={{path:'example.ts',left:{text:'const x = 1;'},right:{text:'const x = 2;'}}} identity="fixture" t={key=>key}/>);
 await wait(()=>button('historyBasic'));
 if(button('historyBasic').getAttribute('aria-pressed')!=='true')throw Error('Advanced diff not enabled by default');
 await wait(()=>button('side')&&host.querySelector('.monaco-diff-editor'));
 if(host.querySelector('.vcs-text-comparison'))throw Error('Fallback remained after editor ready');
 button('side').click();await wait(()=>button('inline'));
 const boxes=host.querySelectorAll('input[type=checkbox]');if(boxes.length!==2)throw Error('Missing review controls');
 boxes[0].click();boxes[1].click();await wait(()=>boxes[0].checked&&boxes[1].checked);
 button('next').click();button('previous').click();
 button('historyBasic').click();await wait(()=>host.querySelector('.vcs-text-comparison')&&!host.querySelector('.monaco-diff-editor'));
 if(host.querySelector('link'))throw Error('Stylesheet leaked');
 if(globalThis.MonacoEnvironment!==initial)throw Error('Viewer environment leaked');
 }finally{root.unmount();host.remove();}
}
