import {build} from 'esbuild';
import {mkdir, copyFile} from 'node:fs/promises';

const common = {bundle: true, minify: true, target: 'es2022', logLevel: 'info'};

// Keep the source host entry external: it owns DSH registration and local grants.
const hostEntryBoundary = {
  name: 'host-entry-boundary',
  setup(builder) {
    builder.onResolve({filter: /index[.]mjs$/}, args =>
      args.path === '../index.mjs' ? {path: '../index.mjs', external: true} : undefined);
  },
};

const targets = [
  {
    entryPoints: ['src/client.jsx'],
    outfile: 'dist/client.js',
    format: 'cjs',
    external: ['react'],
    banner: {js: 'window.__ModuleLoader__.load({ id: "@feng0531/dsh-vcs", factory(require) { var module = { exports: {} }; var exports = module.exports;'},
    footer: {js: 'return module.exports; }});'},
    loader: {'.css': 'text'},
  },
  {
    entryPoints: ['src/editor.js'],
    outfile: 'dist/editor.js',
    format: 'esm',
    loader: {'.ttf': 'dataurl'},
  },
  {
    entryPoints: ['node_modules/monaco-editor/esm/vs/editor/editor.worker.js'],
    outfile: 'dist/editor.worker.js',
    format: 'iife',
  },
  {
    entryPoints: ['src/svn-https-host.mjs'],
    outfile: 'dist/svn-host.mjs',
    platform: 'node',
    format: 'esm',
    packages: 'external',
    plugins: [hostEntryBoundary],
  },
];

await mkdir('dist', {recursive: true});
for (const [source, destination] of [
  ['LICENSE', 'MONACO-LICENSE.txt'],
  ['ThirdPartyNotices.txt', 'MONACO-ThirdPartyNotices.txt'],
]) {
  await copyFile(`node_modules/monaco-editor/${source}`, `dist/${destination}`);
}
// Sequential targets preserve the existing build and diagnostic order.
for (const target of targets) await build({...common, ...target});
console.log('Built DSH VCS client, lazy editor, stylesheet, worker and fixed SVN HTTPS host.');
