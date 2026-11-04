import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {singleFileWindow, SINGLE_WINDOW_LINES, segmentReadingLocation} from '../src/single-file-window.mjs';
const source=Array.from({length:6000},(_,i)=>'text-'+(i+1)).join('\n');
test('segment location rejects fabricated targets and marks either partial boundary',()=>{
 const data={startLine:500,endLine:502,text:'a\r\nb\rc',offset:100,endOffset:110,totalBytes:200,targetFound:true};
 assert.equal(segmentReadingLocation(data,501,true).target,501);
 assert.equal(segmentReadingLocation({...data,endLine:900},800).target,null);
 assert.equal(segmentReadingLocation({...data,targetFound:false},501,true).target,null);
 assert.equal(segmentReadingLocation({...data,endsMidLine:true},501).partial,true);
 assert.equal(segmentReadingLocation({...data,startsMidLine:true},500).partial,true);
 assert.equal(segmentReadingLocation({...data,text:'a\nb\n'},502).target,null);
 assert.equal(segmentReadingLocation({...data,text:'a\nb\n',endOffset:200},502).target,502);
});
test('server-confirmed EOF empty line stays distinct from empty files and unmapped EOF',()=>{
 const eof={text:'',startLine:2,endLine:2,totalBytes:2,offset:2,endOffset:2,targetFound:true,startsMidLine:false,endsMidLine:false};
 const result=segmentReadingLocation(eof,2,true);
 assert.equal(result.emptyLine,true);assert.equal(result.target,2);
 assert.deepEqual(singleFileWindow('',{startLine:2,line:2,emptyLine:result.emptyLine}).rows,[{number:2,text:''}]);
 for(const data of [{...eof,targetFound:false},{...eof,totalBytes:0,offset:0,endOffset:0,startLine:1,endLine:1},{...eof,offset:1},{...eof,endsMidLine:true}]) {
  const location=segmentReadingLocation(data,data.startLine,true);assert.equal(location.emptyLine,false);assert.equal(location.target,null);
 }
 assert.equal(singleFileWindow('',{line:1}).targetFound,false);
 assert.deepEqual(singleFileWindow('').rows,[]);
});
test('legacy segments remain readable with local numbering and no target',()=>{
 const data={text:'a\rb',offset:100};
 const result=segmentReadingLocation(data,1);
 assert.equal(result.located,false);assert.equal(result.startLine,1);assert.equal(result.target,null);
 assert.equal(singleFileWindow(data.text,{startLine:result.startLine}).rows.length,2);
});
test('single window reaches late targets without two-sided alignment',()=>{
 const result=singleFileWindow(source,{line:5000});
 assert.equal(result.rows.length,SINGLE_WINDOW_LINES);
 assert.equal(result.targetFound,true);
 assert.equal(result.rows.find(row=>row.number===5000).text,'text-5000');
 assert.ok(result.startLine>2000);
});
test('window bounds first, last, invalid, missing and empty targets',()=>{
 for(const line of [1,6000,0,-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,6001]){
  const result=singleFileWindow(source,{line});assert.ok(result.rows.length<=500);assert.ok(result.startLine>=1);assert.ok(result.endLine<=6000);
  assert.equal(result.targetFound,line===1||line===6000);
 }
 assert.deepEqual(singleFileWindow('').rows,[]);
});
test('mixed newline boundaries and trailing newline preserve global coordinates',()=>{
 assert.deepEqual(singleFileWindow('a\r\nb\rc\n',{startLine:400,line:402}).rows,[{number:400,text:'a'},{number:401,text:'b'},{number:402,text:'c'},{number:403,text:''}]);
 assert.equal(singleFileWindow('a\nb',{startLine:400,line:399}).targetFound,false);
});
test('explicit anchors allow bounded previous and next windows',()=>{
 const initial=singleFileWindow(source,{line:3000});
 const next=singleFileWindow(source,{line:3000,anchor:initial.endLine+251});
 assert.equal(next.startLine,initial.endLine+1);
 const previous=singleFileWindow(source,{line:3000,anchor:next.startLine-250});
 assert.equal(previous.startLine,initial.startLine);
});
async function component(file){const result=await build({entryPoints:[file],bundle:true,write:false,format:'cjs',external:['react']});const module={exports:{}};vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require:()=>React});return module.exports.default;}
test('single fallback renders one bounded column, absolute target marker and escaped text',async()=>{
 const Text=await component('src/TextComparison.jsx');
 const html=renderToStaticMarkup(React.createElement(Text,{single:true,line:5000,comparison:{right:{text:source.replace('text-5000','<script>target</script>')}}}));
 assert.equal((html.match(/data-line=/g)||[]).length,500);
 assert.match(html,/data-line="5000" data-target="true" aria-current="location"/);
 assert.match(html,/&lt;script&gt;target&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<table|<script>|text-1<|text-6000</);
});
test('historical segment component compiles with shared viewer props',async()=>{
 const Segments=await component('src/HistoricalSegments.jsx');
 const html=renderToStaticMarkup(React.createElement(Segments,{line:5000,t:key=>key}));
 assert.match(html,/aria-expanded="false"/);
});
test('single fallback renders explicitly confirmed EOF empty row but no ordinary empty-file row',async()=>{
 const Text=await component('src/TextComparison.jsx');
 const props={single:true,startLine:2,line:2,comparison:{right:{text:''}}};
 const html=renderToStaticMarkup(React.createElement(Text,{...props,emptyLine:true}));
 assert.match(html,/data-line="2" data-target="true" aria-current="location"/);
 assert.doesNotMatch(renderToStaticMarkup(React.createElement(Text,props)),/data-line=/);
});
test('single segment fallback highlights absolute rather than local coordinates',async()=>{
 const Text=await component('src/TextComparison.jsx');
 const html=renderToStaticMarkup(React.createElement(Text,{single:true,startLine:5000,line:5001,comparison:{right:{text:'a\nb'}}}));
 assert.match(html,/data-line="5001" data-target="true"/);
 assert.doesNotMatch(html,/data-line="1"/);
});
