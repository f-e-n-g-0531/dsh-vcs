import {mkdir,writeFile} from 'node:fs/promises';
import {Script} from 'node:vm';
import {reviewShortcut} from '../src/review-keyboard.mjs';
function run(){
 const root=document.querySelector('#panel'),search=document.querySelector('#search');
 const rows=[
 ['outside','#chat',{key:'f',ctrlKey:true},null],
 ['panel-find','#file',{key:'f',ctrlKey:true},'search'],
 ['panel-mac-find','#file',{key:'f',metaKey:true},'search'],
 ['previous','#file',{key:'ArrowLeft',altKey:true},'previous'],
 ['next','#file',{key:'ArrowRight',altKey:true},'next'],
 ['search-clear','#search',{key:'Escape'},'clear'],
 ['search-find','#search',{key:'f',ctrlKey:true},'search'],
 ['search-no-navigation','#search',{key:'ArrowRight',altKey:true},null],
 ['input','#other',{key:'f',ctrlKey:true},null],
 ['editable','#editable span',{key:'f',ctrlKey:true},null],
 ['monaco','#monaco',{key:'f',ctrlKey:true},null],
 ['composition','#file',{key:'f',ctrlKey:true,isComposing:true},null],
 ['handled','#file',{key:'f',ctrlKey:true},null,true],
 ];
 const results=[];
 for(const [name,selector,init,expected,handled] of rows){
  let action=null;
  const listener=e=>{action=reviewShortcut(e,root,search,true);if(action)e.preventDefault();};
  window.addEventListener('keydown',listener);
  const e=new KeyboardEvent('keydown',{...init,bubbles:true,cancelable:true});
  if(handled)e.preventDefault();
  document.querySelector(selector).dispatchEvent(e);
  window.removeEventListener('keydown',listener);
  results.push({name,action,expected,pass:action===expected&&e.defaultPrevented===!!(expected||handled)});
 }
 document.querySelector('pre').textContent=JSON.stringify({browser:navigator.userAgent,results});
}
const js=reviewShortcut.toString()+';('+run.toString()+')();';
new Script(js);
await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
await writeFile(new URL('../test-results/keyboard-fixture.html',import.meta.url),'<!doctype html><meta charset="utf-8"><title>Synthetic keyboard boundary tests</title><input id="chat"><section id="panel"><input id="search"><input id="other"><button id="file">File</button><div contenteditable="true" id="editable"><span>edit</span></div><div class="monaco-editor"><textarea id="monaco"></textarea></div></section><pre>Not run</pre><script>'+js+'</script>');
