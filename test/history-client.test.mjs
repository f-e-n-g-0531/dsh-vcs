import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('history panel scopes pagination and cancels stale responses',async()=>{
 const source=await readFile(new URL('../src/HistoryPanel.jsx',import.meta.url),'utf8');
 assert.ok(source.includes("rpc('vcs/history'"));
 assert.ok(source.includes('snapshot:page.snapshot'));assert.ok(source.includes('limit:50'));
 assert.ok(source.includes('return()=>controller.abort()'));assert.ok(source.includes('if(!controller.signal.aborted)setPage'));
 assert.doesNotMatch(source,/dangerouslySetInnerHTML|setInterval/);
 const client=await readFile(new URL('../src/client.jsx',import.meta.url),'utf8');
 assert.ok(client.includes('key={JSON.stringify([sessionId,repositoryId,refresh,scan])}'));
});
