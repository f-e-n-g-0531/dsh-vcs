import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {createPage, dictionaries} from '../src/client.jsx';
import {operationLayoutStates} from './operation-layout-cases.mjs';

const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const wait = async (fn, label) => {
  for (let i = 0; i < 200; i++) {if (fn()) return; await new Promise(resolve => setTimeout(resolve, 25));}
  throw Error('Operation layout timeout: ' + label);
};
const rect = node => {const r = node.getBoundingClientRect(); return {top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:r.width, height:r.height};};

// Only authenticated RPC responses and host services are fixtures. DOM, forms,
// state transitions, locale strings and CSS all come from the production page.
export async function checkOperationLayout(config) {
  const {language, width, height, status} = config;
  let activeState='short-reference';
  const host = document.createElement('div');
  host.style.cssText = 'height:100%;width:100%';
  document.body.append(host);
  const root = createRoot(host), failures = [], samples = [], calls = [];
  const t = key => dictionaries[language][key] || key;
  const name = 'feature/' + 'long-reference-segment/'.repeat(12) + '中文-layout';
  const current = {name, ref:'refs/heads/' + name, commit:'a'.repeat(40)};
  const target = {name:name + '-target', ref:'refs/heads/' + name + '-target', commit:'b'.repeat(40)};
  const rpc = async (endpoint, payload) => {
    calls.push(endpoint);
    if (endpoint === 'vcs/repositories') return {cwd:'/fixture', warnings:activeState==='scan-warning'?['Synthetic scan warning '.repeat(20)]:[], repositories:[{id:'operation-layout', type:'git', root:'/fixture',relativePath:activeState==='long-reference'?name:'project',branch:activeState==='long-reference'?name:'main'}]};
    if (endpoint === 'vcs/status') {if(payload.mode!=='all')throw Error('Expected default all mode');if(status==='status-error')throw Error('Synthetic status failure');return {changes:status==='empty'?[]:[{id:'changed',path:'layout.txt',status:'modified',indexStatus:'M',worktreeStatus:'M'}]};}
    throw Error('Unexpected operation-layout endpoint: ' + endpoint);
  };
  const Page = createPage({locale:{bind:()=>t, subscribe:()=>()=>{}, getSnapshot:()=>language}, layout:{selectPanel:()=>{}}, connection:{rpc:{call:async (_route, endpoint, payload)=>({ok:true, value:await rpc(endpoint,payload)})}}});
  const button = key => [...host.querySelectorAll('button')].find(node => node.textContent === t(key));
  try {
    flushSync(() => root.render(<Page useSessions={select=>select({byId:{layout:{id:'layout', cwd:'/fixture', retainedBy:{mainView:1}}}})}/>));
    await wait(() => host.querySelector('.vcs-repository'), 'production status');
    const modeSelect = host.querySelector('select[aria-label="' + t('gitMode') + '"]');
    if(modeSelect)throw Error('Removed change mode selector rendered');
    await wait(() => host.querySelector('.vcs-repository'), 'all changes');
    // With no selected file, production Monaco may keep its empty surface lazy.
    await settle();
    const page = host.querySelector('.vcs-root');
    // This fails if CSS is absent, escaped into literal backslash-n, or ignored.
    if (getComputedStyle(page).display !== 'flex' || getComputedStyle(page).flexDirection !== 'column' || page.querySelector('style').sheet.cssRules.length < 50) throw Error('Production stylesheet is not active');
    for (const state of operationLayoutStates) {
      activeState=state;const before=calls.length;button('refresh').click();await wait(()=>calls.length>before&&host.querySelector('.vcs-repository'),'rescan state');await settle();
      const toolbar=host.querySelector('.vcs-primary-toolbar');
      if(modeSelect||!toolbar.contains(button('refresh'))||!toolbar.contains(button('back'))||button('branchSwitcher'))throw Error('Unified toolbar controls missing or removed feature visible');
      for (const help of [false, true]) {
        for (const details of host.querySelectorAll('.vcs-help')) details.open = help;
        await settle();
        const errors = [], body = host.querySelector('.vcs-body'), ops = host.querySelector('.vcs-operations');
        const bodyRect = rect(body), pageRect = rect(page);
        if (bodyRect.height < 48 || bodyRect.top < pageRect.top - 1 || bodyRect.bottom > pageRect.bottom + 1) errors.push('workspace body lacks 48px usable height');
        for (const input of host.querySelectorAll('.vcs-op input,.vcs-op textarea,.vcs-op select')) {
          const r = rect(input), container = rect(input.closest('label') || input.parentElement);
          if (r.width < 5 || r.left < container.left - 1 || r.right > container.right + 1 || r.left < pageRect.left - 1 || r.right > pageRect.right + 1) errors.push('input overflow: ' + input.getAttribute('aria-label'));
        }
        const scrolling = [];
        const branch = host.querySelector('.vcs-primary-toolbar');
        for (const [label, node] of [['toolbar',branch]]) {
          if (node.scrollWidth > node.clientWidth + 1) errors.push(label + ' horizontal overflow');
          const max = node.scrollHeight - node.clientHeight;
          if (max > 1) {
            if (!['auto','scroll'].includes(getComputedStyle(node).overflowY)) errors.push(label + ' not independently scrollable');
            const before = rect(body); node.scrollTop = max; await settle();
            if (node.scrollTop < max - 1 || Math.abs(rect(body).top - before.top) > 1) errors.push(label + ' scroll moves body or cannot reach end');
            node.scrollTop = 0;
          }
          scrolling.push({label,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,max});
        }
        if(!ops.hidden||host.querySelector('.vcs-branch-create,.vcs-tag-create,.vcs-lightweight-tag,.vcs-branch-delete-preview'))errors.push('Deferred branch/tag operation area rendered');
        if(toolbar.scrollWidth>toolbar.clientWidth+1)errors.push('unified toolbar horizontal overflow');
        samples.push({state,help,bodyHeight:bodyRect.height,scrolling});
        for (const error of errors) failures.push({state,help,error});
      }
    }
    if (calls.some(endpoint => endpoint.endsWith('-confirm'))) throw Error('Layout check invoked a mutation');
    return {...config,pass:failures.length===0,samples,failures};
  } finally {root.unmount();host.remove();}
}
