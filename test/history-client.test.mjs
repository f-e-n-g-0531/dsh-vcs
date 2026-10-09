import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('revision reference entry remains available without loaded HEAD commits',async()=>{
 const source=await readFile(new URL('../src/HistoryPanel.jsx',import.meta.url),'utf8');
 assert.ok(source.includes('\n <RevisionPanel onReferencesLoaded={setReferences} commits={page.commits}'));
 assert.ok(source.includes('!!page.commits.length&&<HistoryGraph'));
 const revisions=await readFile(new URL('../src/RevisionPanel.jsx',import.meta.url),'utf8');
 assert.ok(revisions.includes('if(!load)return;'));
});
test('history Monaco defaults advanced with stable identity and optional fallback',async()=>{
 const source=await readFile(new URL('../src/HistoryViewer.jsx',import.meta.url),'utf8');
 const lifecycle=await readFile(new URL('../src/useHistoryEditor.mjs',import.meta.url),'utf8');
 assert.ok(source.includes('useHistoryEditor({comparison,identity,enabled,single,line,sideBySide,ignoreWhitespace,wrap})'));
 assert.ok(source.includes('[enabled,setEnabled]=useState(true)'));
 assert.ok(lifecycle.includes('if (!enabled) return'));
 assert.ok(lifecycle.includes('task.dispose()'));assert.ok(lifecycle.includes('link.remove()'));
 assert.ok(source.includes('!ready&&<TextComparison'));
 const wrapper=await readFile(new URL('../src/HistoryComparison.jsx',import.meta.url),'utf8');
 assert.ok(wrapper.includes('JSON.stringify([sessionId,repositoryId,commit,parentIndex,id])'));
});
test('history editor controls are ready-only and instance scoped',async()=>{
 const source=await readFile(new URL('../src/HistoryViewer.jsx',import.meta.url),'utf8');
 assert.ok(source.includes('ready&&!single&&<div'));
 const lifecycle=await readFile(new URL('../src/useHistoryEditor.mjs',import.meta.url),'utf8');
 assert.ok(lifecycle.includes('if (ready) viewer.current?.options({sideBySide, ignoreWhitespace, wrap})'));
 for(const direction of ['previous','next'])assert.ok(source.includes("viewer.current?.navigate('"+direction+"')"));
 assert.ok(lifecycle.includes('viewer.current = null;'));
 assert.ok(lifecycle.includes('try { task.dispose(); } finally { link.remove(); }'));
});
test('history panel scopes pagination and cancels stale responses',async()=>{
 const source=await readFile(new URL('../src/HistoryPanel.jsx',import.meta.url),'utf8');
 assert.ok(source.includes("rpc('vcs/history'"));
 assert.ok(source.includes('snapshot:page.snapshot'));assert.ok(source.includes('limit:50'));
 assert.ok(source.includes('return()=>controller.abort()'));assert.ok(source.includes('if(!controller.signal.aborted){setPage'));
 assert.doesNotMatch(source,/dangerouslySetInnerHTML|setInterval/);
 const client=await readFile(new URL('../src/client.jsx',import.meta.url),'utf8');
 assert.ok(client.includes('key={JSON.stringify([sessionId,repositoryId,historyRefresh,scan])}'));
});
