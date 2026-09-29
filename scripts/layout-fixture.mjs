import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';
import assert from 'node:assert/strict';

// No server, dependencies or repository access. Open the generated file in a browser.
const css=await readFile(new URL('../src/style.css',import.meta.url),'utf8');
const locales=JSON.parse(await readFile(new URL('../src/locales.json',import.meta.url),'utf8'));
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const cases=[];
for(const lang of ['zh','en']) for(const width of [180,260]) for(const zoom of [1,1.25,2]) {
 const d=locales[lang];
 const buttons=['allFiles','M','A','D','R','U','?'].map((key,i)=>'<button aria-pressed="'+(i===0)+'">'+escape(d[key])+' <small>1234</small></button>').join('');
 cases.push('<section><h2>'+lang+' / '+width+'px / CSS zoom '+zoom+'</h2><div class="vcs-root" style="width:800px;height:320px;zoom:'+zoom+'"><div class="vcs-body"><aside class="vcs-files" style="width:'+width+'px;flex-shrink:0"><div class="vcs-filter"><input aria-label="Search" placeholder="Search"></div><div class="vcs-status-filter">'+buttons+'</div><nav class="vcs-filelist">'+Array.from({length:40},(_,i)=>'<button class="vcs-file">file-'+i+'.txt</button>').join('')+'</nav></aside></div></div></section>');
}
const check=()=>{
 const results=[];
 for(const section of document.querySelectorAll('section')) {
  section.scrollIntoView();
  const group=section.querySelector('.vcs-status-filter'), buttons=[...group.querySelectorAll('button')];
  const parent=group.getBoundingClientRect(), rects=buttons.map(b=>b.getBoundingClientRect());
  const inside=rects.every(r=>r.left>=parent.left-1&&r.right<=parent.right+1&&r.top>=parent.top-1&&r.bottom<=parent.bottom+1);
  const overlap=rects.some((r,i)=>rects.slice(i+1).some(s=>r.left<s.right&&r.right>s.left&&r.top<s.bottom&&r.bottom>s.top));
  const list=section.querySelector('nav').getBoundingClientRect();
  const rename=buttons[4]; rename.scrollIntoView({block:'center',inline:'center'});
  const r=rename.getBoundingClientRect(), hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
  results.push({case:section.querySelector('h2').textContent,pass:inside&&!overlap&&list.top>=parent.bottom-1&&!!hit&&rename.contains(hit),inside,overlap,renameHit:!!hit&&rename.contains(hit)});
 }
 document.querySelector('pre').textContent=JSON.stringify({browser:navigator.userAgent,results},null,2);
 document.body.dataset.result=results.every(r=>r.pass)?'pass':'fail';
 window.scrollTo(0,0);
};
const html='<!doctype html><meta charset="utf-8"><title>DSH VCS isolated layout checks</title><style>:root{--dsw-font-family:Arial,sans-serif;--dsw-alias-bg-base:white;--dsw-alias-label-primary:#222;--dsw-alias-border-l2:#888}section{margin-bottom:30px}'+css+'</style><h1>Isolated layout fixture — NOT live DSH acceptance</h1><p>CSS zoom is not browser zoom. Use a desktop browser and run again after resizing.</p><button id="run">Run geometry checks</button><pre>Not run</pre>'+cases.join('')+'<script>const check='+check.toString()+';document.querySelector("#run").onclick=check;if(location.hash==="#autorun")window.addEventListener("load",()=>document.fonts.ready.then(check));</script>';
assert.equal(cases.length,12);
new Script(html.split('<script>')[1].split('</script>')[0]);
const output=new URL('../test-results/layout-fixture.html',import.meta.url);
await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
await writeFile(output,html);
console.log('Open in a browser: '+fileURLToPath(output));
console.log('Generation alone does not execute browser checks.');
