import {build} from 'esbuild';
import {mkdir, copyFile,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

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
  {entryPoints:['src/updates.mjs'],outfile:'dist/updates.mjs',platform:'node',format:'esm',packages:'external'},
  {entryPoints:['src/client.jsx'],outfile:'dist/interface.js',format:'cjs',external:['react'],loader:{'.css':'text'},banner:{js:'export default function(require) { var module = {exports:{}}; var exports=module.exports;'},footer:{js:'return module.exports; }'}},
  {
    entryPoints: ['src/client-bootstrap.jsx'],
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
const pkg=JSON.parse(await readFile('package.json','utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const backendFiles=pkg.files.filter(name=>name.endsWith('.mjs')).concat('dist/svn-host.mjs','dist/updates.mjs').sort();
const backend=createHash('sha256');for(const file of backendFiles){backend.update(file);backend.update((await readFile(file,'utf8')).replaceAll('\r\n','\n'));}backend.update(JSON.stringify({dependencies:pkg.dependencies,peers:pkg.peerDependencies}));backend.update(await readFile('package-lock.json','utf8').then(text=>{const lock=JSON.parse(text);delete lock.version;delete lock.packages[''].version;return JSON.stringify(lock);}));for(const file of ['src/client-bootstrap.jsx','src/UpdatePanel.jsx','src/update-client.mjs','src/update-protocol.mjs','src/frontend-loader.mjs','build.mjs','dist/editor.js','dist/editor.css','dist/editor.worker.js','src/locales.json'])backend.update((await readFile(file,'utf8')).replaceAll('\r\n','\n'));
await writeFile('dist/frontend.json',JSON.stringify({protocol:1,version:pkg.version,backend:backend.digest('hex'),interface:hash(await readFile('dist/interface.js'))})+'\n');
console.log('Built stable loader, versioned interface, editor and backend fingerprint.');
