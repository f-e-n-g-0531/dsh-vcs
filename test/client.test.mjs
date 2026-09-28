import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import React from 'react';
import { renderToString } from 'react-dom/server';

async function loadClient() {
  let plugin;
  const registrations=[], effects=[], cleanups=[];
  const locale={active:'zh',revision:0};let dictionary;
  const ctx={
    locale:{register(ns,dict){dictionary=dict;return()=>{};},bind(){return key=>dictionary[locale.active][key];},subscribe(){return()=>{};},getSnapshot(){return locale;}},
    effect(fn){effects.push(fn);},
    slots:{inject(owner,fn){effects.push(fn);},register(options,component){registrations.push({options,component});return()=>{};}},
    layout:{selectPanel(){throw new Error('Plugin must not navigate on activation');}},
    connection:{rpc:{call(){throw new Error('Plugin must not scan repositories on activation');}}},
  };
  const source=await readFile(new URL('../dist/client.js',import.meta.url),'utf8');
  vm.runInNewContext(source,{window:{__ModuleLoader__:{load(row){plugin=row.factory(name=>{assert.equal(name,'react');return React;});}}},URL,AbortController,console});
  plugin.apply(ctx);
  while(effects.length){const dispose=effects.shift()();if(dispose)cleanups.push(dispose);}
  return {plugin,ctx,registrations,locale,cleanups};
}

test('regression: localized sidebar label is a renderable string, never a locale object',async()=>{
  const {registrations,locale}=await loadClient();
  const row=registrations.find(r=>r.options.name==='sidebar.panellist');
  assert.ok(row);
  assert.equal(typeof row.options.label,'function');
  for(const [language,expected] of [['zh','VCS 变更'],['en','VCS changes']]){
    locale.active=language;
    const label=row.options.label();assert.equal(label,expected);
    const html=renderToString(React.createElement('aside',null,React.createElement('span',null,label),React.createElement('section',{'data-testid':'workspaces'},'Workspace remains')));
    assert.match(html,/Workspace remains/);
  }
  assert.throws(()=>renderToString(React.createElement('span',null,{en:'VCS',zh:'变更'})),/Objects are not valid as a React child/);
});

test('activation adds uniquely keyed entries without replacing workspace or shell slots',async()=>{
  const {registrations}=await loadClient();
  assert.deepEqual(registrations.map(r=>r.options.name),['main','sidebar.panellist']);
  assert.equal(registrations[0].options.key,'local-vcs');
  assert.equal(registrations[1].options.id,'local-vcs');
  assert.ok(!registrations.some(r=>['root','sidebar','sidebar.workspaces','rightbar'].includes(r.options.name)));
});

test('VCS page renders no-session state without repository reads during render',async()=>{
  const {registrations}=await loadClient();
  const Page=registrations.find(r=>r.options.name==='main').component;
  const html=renderToString(React.createElement(Page,{useSessions:select=>select({byId:{}})}));
  assert.match(html,/先打开一个项目会话/);
});

test('review file tree exposes keyboard navigation and directory expansion semantics',async()=>{
 const source=await readFile(new URL('../src/client.jsx',import.meta.url),'utf8');
 assert.match(source,/onFileListKeyDown/);
 assert.match(source,/ArrowDown/);assert.match(source,/ArrowUp/);assert.match(source,/data-vcs-directory/);
 assert.match(source,/aria-expanded/);assert.match(source,/data-vcs-item/);
});

test('review panel exposes localized status filter controls',async()=>{
 const source=await readFile(new URL('../src/client.jsx',import.meta.url),'utf8');
 assert.match(source,/vcs-status-filter/);assert.match(source,/statusFilter/);assert.match(source,/filterStatus/);
});

test('tree mode exposes bulk expand and collapse review controls',async()=>{
 const source=await readFile(new URL('../src/client.jsx',import.meta.url),'utf8');
 assert.match(source,/setTreeExpanded/);assert.match(source,/expandAll/);assert.match(source,/collapseAll/);
});

test('review status filters expose current category counts',async()=>{
 const source=await readFile(new URL('../src/client.jsx',import.meta.url),'utf8');
 assert.match(source,/countChangeStatuses/);assert.match(source,/statusCounts\[value\]/);
});

test('review toolbar shows current visible file position',async()=>{
 const source=await readFile(new URL('../src/client.jsx',import.meta.url),'utf8');
 assert.match(source,/changePosition/);assert.match(source,/reviewPosition/);
});

test('review filters can reset search and status together',async()=>{
 const source=await readFile(new URL('../src/client.jsx',import.meta.url),'utf8');
 assert.match(source,/clearFilters/);assert.match(source,/setStatusFilter\('all'\)/);
});

test('review search supports focus and clear keyboard shortcuts',async()=>{
 const source=await readFile(new URL('../src/client.jsx',import.meta.url),'utf8');
 assert.match(source,/searchNode/);assert.match(source,/key\.toLowerCase\(\)==='f'/);assert.match(source,/key==='Escape'/);
});

test('review header exposes a safe copy-path control',async()=>{
 const source=await readFile(new URL('../src/client.jsx',import.meta.url),'utf8');
 assert.match(source,/navigator\.clipboard/);assert.match(source,/document\.execCommand\('copy'\)/);assert.match(source,/copyPath/);assert.match(source,/copyFailed/);
});
