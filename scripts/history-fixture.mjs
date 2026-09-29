import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('test-results',{recursive:true});
const result=await build({entryPoints:['scripts/history-browser.jsx'],bundle:true,write:false,format:'iife',define:{'process.env.NODE_ENV':'"production"'}});
await writeFile('test-results/history-fixture.html','<!doctype html><meta charset="utf-8"><div id="root"></div><pre id="report">Not run</pre><script>'+result.outputFiles[0].text.replaceAll('</script','<\/script')+'</script>');
