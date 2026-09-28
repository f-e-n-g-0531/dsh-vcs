import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
async function component(file){const result=await build({entryPoints:[file],bundle:true,write:false,format:'cjs',external:['react']});const module={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:()=>React});return module.exports.default;}
test('text fallback renders safe content without editor assets',async()=>{
 const Text=await component('src/TextComparison.jsx');const html=renderToStaticMarkup(React.createElement(Text,{comparison:{left:{label:'HEAD',text:'<script>old</script>'},right:{label:'Working',text:'new'}}}));
 assert.ok(html.includes('&lt;script&gt;old&lt;/script&gt;'));assert.match(html,/new/);assert.doesNotMatch(html,/<script>/);
});
