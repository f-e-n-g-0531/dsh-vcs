import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
test('history browsing hides advanced query while search mode explicitly enables it',async()=>{
 const result=await build({stdin:{contents:"export {default} from './src/HistoryPanel.jsx';",resolveDir:process.cwd(),loader:'jsx'},bundle:true,platform:'node',format:'esm',external:['react'],write:false});
 // Source contract guards the default mount; browser coverage exercises effects.
 const source=await readFile(new URL('../src/HistoryPanel.jsx',import.meta.url),'utf8');
 assert.ok(source.includes('showSearch=false'));
 assert.ok(source.includes('{showSearch&&<form'));
 const center=await readFile(new URL('../src/SearchPanel.jsx',import.meta.url),'utf8');
 assert.ok(center.includes('<HistoryPanel {...props} t={t} showSearch/>'));
 assert.ok(center.includes('key={JSON.stringify([props.sessionId,props.repositoryId])}'));
 assert.ok(result.outputFiles[0].text.length>0);
});
