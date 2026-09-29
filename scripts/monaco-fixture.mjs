import {mkdir,writeFile} from 'node:fs/promises';
await mkdir('test-results',{recursive:true});
await writeFile('test-results/monaco-fixture.html',`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="../dist/editor.css"><div id="a" style="height:300px;width:900px"></div><div id="b" style="height:300px;width:900px"></div><pre id="report">pending</pre><script type="module">
const report=document.querySelector('#report'),errors=[];let phase='load',sa,sb;
window.addEventListener('error',e=>errors.push(e.message));
const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Diff computation timeout');};
try{
 const initial=globalThis.MonacoEnvironment;
 const one=await import('../dist/editor.js?retry=0'),two=await import('../dist/editor.js?retry=1');
 phase='initial-diffs';
 const a=one.createDiff(document.querySelector('#a'),{onStats:s=>sa=s});
 const b=two.createDiff(document.querySelector('#b'),{onStats:s=>sb=s});
 const data=text=>({path:'example.ts',left:{text:'const x = 1;'},right:{text}});
 a.setContent(data('const x = 2;'),'a');b.setContent(data('const x = 3;'),'b');
 await wait(()=>sa?.count>0&&sb?.count>0);
 if(document.querySelectorAll('.monaco-diff-editor').length!==2)throw Error('Two editors not rendered');
 phase='survivor-update';a.dispose();sb=null;b.setContent(data('const x = 4;'),'b2');await wait(()=>sb?.count>0);
 b.dispose();
 if(document.querySelectorAll('.monaco-diff-editor').length)throw Error('Editor DOM leaked');
 if(globalThis.MonacoEnvironment!==initial)throw Error('Environment not restored');
 if(errors.length)throw Error(errors.join('; '));
 report.textContent=JSON.stringify({pass:true,browser:navigator.userAgent,steps:['two-modules','two-diffs','survivor-update','dispose']});
}catch(e){report.textContent=JSON.stringify({pass:false,error:String(e),phase,sa,sb,errors});}
</script>`);
