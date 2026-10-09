import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {build} from 'esbuild';
await mkdir('test-results/vcs-assets',{recursive:true});
for(const file of ['editor.js','editor.css','editor.worker.js'])await copyFile('dist/'+file,'test-results/vcs-assets/'+file);
await build({entryPoints:['scripts/history-viewer-browser.jsx'],outfile:'test-results/history-viewer-browser.js',bundle:true,format:'esm',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'}});
await build({entryPoints:['scripts/graph-native-browser.jsx'],outfile:'test-results/graph-native-browser.js',bundle:true,format:'esm',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'}});
await build({entryPoints:['scripts/blame-native-browser.jsx'],outfile:'test-results/blame-native-browser.js',bundle:true,format:'esm',loader:{'.css':'text'},define:{'process.env.NODE_ENV':'"production"'}});
await writeFile('test-results/monaco-fixture.html',`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="../dist/editor.css"><div id="a" style="height:300px;width:900px"></div><div id="b" style="height:300px;width:900px"></div><pre id="report">pending</pre><script type="module">
const report=document.querySelector('#report'),errors=[];let phase='load',sa,sb;
window.addEventListener('error',e=>errors.push(e.message));
const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Diff computation timeout');};
try{
 const initial=globalThis.MonacoEnvironment;
 const one=await import('../dist/editor.js?retry=0'),two=await import('../dist/editor.js?retry=1');
 const cases=[];
 for(const mode of ['same','retry'])for(const first of [0,1]){
 sa=null;sb=null;phase=mode+'-'+first+'-initial-diffs';
 const a=one.createDiff(document.querySelector('#a'),{onStats:s=>sa=s});
 const b=(mode==='same'?one:two).createDiff(document.querySelector('#b'),{onStats:s=>sb=s});
 const data=text=>({path:'example.ts',left:{text:'const x = 1;'},right:{text}});
 a.setContent(data('const x = 2;'),'a');b.setContent(data('const x = 3;'),'b');
 await wait(()=>sa?.count>0&&sb?.count>0);
 if(document.querySelectorAll('.monaco-diff-editor').length!==2)throw Error('Two editors not rendered');
 phase=mode+'-'+first+'-survivor-update';
 const editors=[a,b];editors[first].dispose();sa=null;sb=null;
 editors[1-first].setContent(data('const x = 4;'),'survivor');await wait(()=>first===0?sb?.count>0:sa?.count>0);
 editors[1-first].dispose();
 if(document.querySelectorAll('.monaco-diff-editor').length)throw Error('Editor DOM leaked');
 if(globalThis.MonacoEnvironment!==initial)throw Error('Environment not restored');
 cases.push(mode+'-'+first);
 }
 phase='react-controls';await (await import('./history-viewer-browser.js')).checkViewer();
 phase='revision-controls';await (await import('./history-viewer-browser.js')).checkRevisions();
 phase='file-history';await (await import('./history-viewer-browser.js')).checkFileHistory();
 phase='blame';await (await import('./history-viewer-browser.js')).checkBlame();
 phase='tree';await (await import('./history-viewer-browser.js')).checkTree();
 phase='blame-location';await (await import('./history-viewer-browser.js')).checkBlameLocation();
 phase='follow-history';await (await import('./history-viewer-browser.js')).checkFollowHistory();
 phase='branch-history';await (await import('./history-viewer-browser.js')).checkBranchHistory();
 phase='history-server-search';await (await import('./history-viewer-browser.js')).checkHistorySearch();
 phase='review-views';await (await import('./history-viewer-browser.js')).checkReviewViews();
 phase='history-refs';await (await import('./history-viewer-browser.js')).checkHistoryRefs();
 phase='graph';await (await import('./history-viewer-browser.js')).checkGraph();
 phase='image';await (await import('./history-viewer-browser.js')).checkImage();
 phase='image-ui';await (await import('./history-viewer-browser.js')).checkImageUI();
 if(errors.length)throw Error(errors.join('; '));
 report.textContent=JSON.stringify({pass:true,browser:navigator.userAgent,cases,steps:['two-modules','two-diffs','survivor-update','dispose','react-controls','revision-controls','file-history','blame','tree','graph','image','image-ui']});
}catch(e){report.textContent=JSON.stringify({pass:false,error:String(e),phase,sa,sb,errors});}
</script>`);
