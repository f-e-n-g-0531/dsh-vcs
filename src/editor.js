import {createEnvironmentOwner} from './editor-environment.mjs';
import {diffStatus} from './diff-status.mjs';
const acquireEnvironment=createEnvironmentOwner(globalThis,(url,label)=>new Worker(url??new URL('./editor.worker.js',import.meta.url),{name:label}));
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';

// Read-only diagnostics for isolated resource regression; exposes no source text.
export const getEditorResources = () => ({models: monaco.editor.getModels().length});

const languages = {ts:'typescript',tsx:'typescript',js:'javascript',jsx:'javascript',mjs:'javascript',cpp:'cpp',h:'cpp',hpp:'cpp',c:'cpp',cs:'csharp',py:'python',xml:'xml',html:'xml',yml:'yaml',yaml:'yaml',md:'markdown'};
function color(value) {
  if (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) return value;
  if (!value || !CSS.supports('color', value)) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  // Canvas normalizes CSS colors, including rgba()/color-mix(), to RGBA bytes.
  // Monaco accepts hexadecimal colors only, not canvas.fillStyle's rgba text.
  return '#' + Array.from(context.getImageData(0, 0, 1, 1).data,
    channel => channel.toString(16).padStart(2, '0')).join('');
}
const themeTokens={
  'editor.background':'--dsw-alias-bg-base',
  'editor.foreground':'--dsw-alias-label-primary',
  'editorLineNumber.foreground':'--dsw-alias-label-tertiary',
  'editorGutter.background':'--dsw-alias-bg-base',
  'diffEditor.insertedTextBackground':'--dsw-alias-code-diff-added',
  'diffEditor.removedTextBackground':'--dsw-alias-code-diff-deleted',
  'diffEditor.insertedLineBackground':'--dsw-alias-file-diff-added-bg',
  'diffEditor.removedLineBackground':'--dsw-alias-file-diff-deleted-bg',
};
let themeInput,appliedTheme,themeUsers=0,themeObserver,themeFrame=0;
function updateTheme() {
  const body=document.body,style=getComputedStyle(body);
  const base=body.hasAttribute('data-ds-dark-theme')?'vs-dark':'vs';
  const entries=Object.entries(themeTokens).map(([name,token])=>[name,style.getPropertyValue(token).trim()]);
  const input=JSON.stringify([base,entries]);
  if(input===themeInput)return;
  const colors=Object.fromEntries(entries.map(([name,value])=>[name,color(value)]).filter(([,value])=>value!==undefined));
  const palette=JSON.stringify([base,colors]);
  if(palette!==appliedTheme){
    monaco.editor.defineTheme('dsh-vcs',{base,inherit:true,rules:[],colors});
    monaco.editor.setTheme('dsh-vcs');
    appliedTheme=palette;
  }
  themeInput=input;
}
// One observer per Monaco module, no CSS replacement when effective tokens did not change.
function acquireTheme(){
  if(themeUsers===0){
    updateTheme();
    themeObserver=new MutationObserver(()=>{
      if(themeFrame)return;
      themeFrame=requestAnimationFrame(()=>{themeFrame=0;updateTheme();});
    });
    themeObserver.observe(document.body,{attributes:true,attributeFilter:['data-ds-dark-theme','style','class']});
  }
  themeUsers++;
  return ()=>{
    if(--themeUsers)return;
    themeObserver.disconnect();themeObserver=undefined;
    cancelAnimationFrame(themeFrame);themeFrame=0;
  };
}
export function createDiff(node, { onStats, onComputation, single = false, maxComputationTime = 3000 } = {}) {
  const releaseEnvironment = acquireEnvironment();
  let editor, releaseTheme, subscription, sizeObserver, layoutFrame;
  let models = [], key = '', disposed = false, viewModel, computationTimer;
  const reportComputation = () => {if(!disposed)onComputation?.(diffStatus(viewModel));};
  const states = new Map();
  const armComputationDeadline = () => {
    clearTimeout(computationTimer);
    computationTimer=setTimeout(()=>{if(!disposed&&diffStatus(viewModel)!=='complete')onComputation?.('incomplete');},10000);
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    // One failing cleanup must not leave the global worker hook installed.
    const cleanups = [() => sizeObserver?.disconnect(), () => cancelAnimationFrame(layoutFrame), () => releaseTheme?.(), () => subscription?.dispose(),
      () => clearTimeout(computationTimer), () => viewModel?.dispose(), () => editor?.dispose(), ...models.map(model => () => model.dispose())];
    try {
      for (const cleanup of cleanups) { try { cleanup(); } catch (error) { console.warn('VCS editor cleanup failed', error); } }
    } finally {
      releaseEnvironment();
      states.clear(); models = [];
    }
  }
  try {
  releaseTheme=acquireTheme();
  editor = (single?monaco.editor.create:monaco.editor.createDiffEditor)(node, {readOnly:true,originalEditable:false,domReadOnly:true,automaticLayout:false,renderSideBySide:true,useInlineViewWhenSpaceIsLimited:false,ignoreTrimWhitespace:false,minimap:{enabled:false},fontSize:13,scrollBeyondLastLine:false,renderOverviewRuler:false,hideUnchangedRegions:{enabled:true,contextLineCount:4,minimumLineCount:8},maxComputationTime,cursorBlinking:'solid',accessibilityVerbose:true});
  // Schedule layout outside ResizeObserver delivery to avoid synchronous resize loops.
   let layoutWidth=-1,layoutHeight=-1;
   sizeObserver=new ResizeObserver(()=>{
     cancelAnimationFrame(layoutFrame);
     layoutFrame=requestAnimationFrame(()=>{
       if(disposed)return;
       const width=node.clientWidth,height=node.clientHeight;
       if(width===layoutWidth&&height===layoutHeight)return;
       layoutWidth=width;layoutHeight=height;editor.layout({width,height});
     });
   });
   sizeObserver.observe(node);
  subscription = single ? undefined : editor.onDidUpdateDiff(() => {
    reportComputation();
    const changes = editor.getLineChanges() || [];
    const stats = changes.reduce((out,c) => {out.added += c.modifiedEndLineNumber ? c.modifiedEndLineNumber-c.modifiedStartLineNumber+1:0; out.deleted += c.originalEndLineNumber ? c.originalEndLineNumber-c.originalStartLineNumber+1:0; return out;},{added:0,deleted:0,count:changes.length});
    onStats?.(stats);
  });
  return {
    setContent(data,nextKey) {
      if (disposed) return;
      if(key) states.set(key,editor.saveViewState());
      if(states.size>100) states.delete(states.keys().next().value);
      clearTimeout(computationTimer);
      editor.setModel(null); viewModel?.dispose(); viewModel=undefined; models.forEach(m=>m.dispose());
      const language = languages[data.path?.split('.').pop()?.toLowerCase()] || 'plaintext';
      models = [];
      try {
        if(!single)models.push(monaco.editor.createModel(data.left.text || '',language));
        models.push(monaco.editor.createModel(data.right.text || '',language));
      } catch (error) {
        models.forEach(model => model.dispose()); models = [];
        throw error;
      }
      if(single)editor.setModel(models[0]);
      else {
        viewModel=editor.createViewModel({original:models[0],modified:models[1]});
        onComputation?.('pending');
        editor.setModel(viewModel);
        // Worker may never return a usable result: never imply equality on silence.
        armComputationDeadline();
      }
      key=nextKey;
      if(states.has(key)) editor.restoreViewState(states.get(key));
    },
    options({sideBySide,ignoreWhitespace,wrap,startLine=1}) {editor.updateOptions({renderSideBySide:sideBySide,ignoreTrimWhitespace:ignoreWhitespace,wordWrap:wrap?'on':'off',...(single?{lineNumbers:line=>String(line+(Number.isSafeInteger(startLine)&&startLine>0?startLine:1)-1)}:{})});if(!single){reportComputation();armComputationDeadline();}},
    revealLine(line) {if(!single||!Number.isInteger(line)||line<1||line>models[0]?.getLineCount())return false;editor.setSelection({startLineNumber:line,startColumn:1,endLineNumber:line,endColumn:models[0].getLineMaxColumn(line)});editor.revealLineInCenter(line);return true;},
    navigate(direction) {if(!single)editor.goToDiff(direction);},
    snapshot() {
      if(disposed)return null;
      return {lengths:models.map(model=>model.getValueLength()),lines:models.map(model=>model.getLineCount()),computation:diffStatus(viewModel),changes:single?null:editor.getLineChanges()};
    },
    dispose
  };
  } catch (error) {
    dispose();
    throw error;
  }
}
