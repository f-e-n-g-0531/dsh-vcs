import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/python/python.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js';
import 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js';

const languages = {ts:'typescript',tsx:'typescript',js:'javascript',jsx:'javascript',mjs:'javascript',cpp:'cpp',h:'cpp',hpp:'cpp',c:'cpp',cs:'csharp',py:'python',xml:'xml',html:'xml',yml:'yaml',yaml:'yaml',md:'markdown'};
function color(token) {
  const value = getComputedStyle(document.body).getPropertyValue(token).trim();
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
function updateTheme() {
  monaco.editor.defineTheme('dsh-vcs', {base:document.body.hasAttribute('data-ds-dark-theme')?'vs-dark':'vs',inherit:true,rules:[],colors:Object.fromEntries(Object.entries({
    'editor.background':color('--dsw-alias-bg-base'),
    'editor.foreground':color('--dsw-alias-label-primary'),
    'editorLineNumber.foreground':color('--dsw-alias-label-tertiary'),
    'editorGutter.background':color('--dsw-alias-bg-base'),
    'diffEditor.insertedTextBackground':color('--dsw-alias-code-diff-added'),
    'diffEditor.removedTextBackground':color('--dsw-alias-code-diff-deleted'),
    'diffEditor.insertedLineBackground':color('--dsw-alias-file-diff-added-bg'),
    'diffEditor.removedLineBackground':color('--dsw-alias-file-diff-deleted-bg'),
  }).filter(([, value]) => value !== undefined))});
  monaco.editor.setTheme('dsh-vcs');
}
export function createDiff(node, { onStats } = {}) {
  const workers = new Set();
  const previousEnvironment = globalThis.MonacoEnvironment;
  const hadEnvironment = Object.prototype.hasOwnProperty.call(globalThis, 'MonacoEnvironment');
  const environment = { ...previousEnvironment, getWorker(moduleId, label) {
    // Only Monaco's ordinary editor worker belongs to this bundle. Preserve
    // existing language-service workers and their owner's disposal lifetime.
    if (label !== 'editorWorkerService') {
      if (typeof previousEnvironment?.getWorker === 'function') return previousEnvironment.getWorker(moduleId, label);
      if (typeof previousEnvironment?.getWorkerUrl === 'function') return new Worker(previousEnvironment.getWorkerUrl(moduleId, label), { name: label });
      throw new Error('Unsupported Monaco worker: ' + label);
    }
    if (disposed) throw new Error('VCS editor has been disposed.');
    const worker = new Worker(new URL('./editor.worker.js', import.meta.url), { name: label });
    workers.add(worker);
    return worker;
  } };
  let editor, observer, subscription;
  let models = [], key = '', disposed = false;
  const states = new Map();
  function dispose() {
    if (disposed) return;
    disposed = true;
    // One failing cleanup must not leave the global worker hook installed.
    const cleanups = [() => observer?.disconnect(), () => subscription?.dispose(),
      () => editor?.dispose(), ...models.map(model => () => model.dispose()),
      ...Array.from(workers, worker => () => worker.terminate())];
    try {
      for (const cleanup of cleanups) { try { cleanup(); } catch (error) { console.warn('VCS editor cleanup failed', error); } }
    } finally {
      if (globalThis.MonacoEnvironment === environment) {
        if (hadEnvironment) globalThis.MonacoEnvironment = previousEnvironment;
        else delete globalThis.MonacoEnvironment;
      }
      states.clear(); workers.clear(); models = [];
    }
  }
  globalThis.MonacoEnvironment = environment;
  try {
  updateTheme();
  editor = monaco.editor.createDiffEditor(node, {readOnly:true,originalEditable:false,domReadOnly:true,automaticLayout:true,renderSideBySide:true,useInlineViewWhenSpaceIsLimited:false,ignoreTrimWhitespace:false,minimap:{enabled:false},fontSize:13,scrollBeyondLastLine:false,renderOverviewRuler:false,hideUnchangedRegions:{enabled:true,contextLineCount:4,minimumLineCount:8},maxComputationTime:3000,accessibilityVerbose:true});
  observer = new MutationObserver(updateTheme);
  observer.observe(document.body,{attributes:true,attributeFilter:['data-ds-dark-theme','style','class']});
  subscription = editor.onDidUpdateDiff(() => {
    const changes = editor.getLineChanges() || [];
    const stats = changes.reduce((out,c) => {out.added += c.modifiedEndLineNumber ? c.modifiedEndLineNumber-c.modifiedStartLineNumber+1:0; out.deleted += c.originalEndLineNumber ? c.originalEndLineNumber-c.originalStartLineNumber+1:0; return out;},{added:0,deleted:0,count:changes.length});
    onStats?.(stats);
  });
  return {
    setContent(data,nextKey) {
      if (disposed) return;
      if(key) states.set(key,editor.saveViewState());
      if(states.size>100) states.delete(states.keys().next().value);
      editor.setModel(null); models.forEach(m=>m.dispose());
      const language = languages[data.path?.split('.').pop()?.toLowerCase()] || 'plaintext';
      models = [];
      try {
        models.push(monaco.editor.createModel(data.left.text || '',language));
        models.push(monaco.editor.createModel(data.right.text || '',language));
      } catch (error) {
        models.forEach(model => model.dispose()); models = [];
        throw error;
      }
      editor.setModel({original:models[0],modified:models[1]}); key=nextKey;
      if(states.has(key)) editor.restoreViewState(states.get(key));
    },
    options({sideBySide,ignoreWhitespace,wrap}) {editor.updateOptions({renderSideBySide:sideBySide,ignoreTrimWhitespace:ignoreWhitespace,wordWrap:wrap?'on':'off'});},
    navigate(direction) {editor.goToDiff(direction);},
    dispose
  };
  } catch (error) {
    dispose();
    throw error;
  }
}
