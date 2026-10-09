import assert from 'node:assert/strict';
import {parsePackReport} from './pack-report.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const required = [
  'package.json', 'index.mjs', 'vcs.mjs', 'git-history.mjs', 'image-preview.mjs', 'src/svn-identity.mjs', 'src/svn-target.mjs', 'src/svn-path.mjs', 'src/svn-revision.mjs', 'dist/client.js',
  'dist/editor.js', 'dist/editor.css', 'dist/editor.worker.js',
  'dist/MONACO-LICENSE.txt', 'dist/MONACO-ThirdPartyNotices.txt',
  'locale/en.json', 'locale/zh.json', 'icon.svg', 'cordis.patch.yml',
  'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'docs/RELEASING.md',
];

function verify() {
  assert.equal(process.argv.length, 2, 'Usage: node scripts/verify-package.mjs (no arguments)');
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.name, '@feng0531/dsh-vcs', 'Unexpected package name');
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'Version must be X.Y.Z');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.private, false, 'npm publication must be enabled');
  assert.deepEqual(manifest.publishConfig, {access:'public',registry:'https://registry.npmjs.org/'});
  assert.ok(readFileSync(new URL('../dist/client.js',import.meta.url),'utf8').includes('id: '+JSON.stringify(manifest.name)), 'Client loader identity must match package');
  assert.ok(typeof manifest.license === 'string' && manifest.license.length > 0, 'Missing license metadata');
  assert.deepEqual(manifest.exports, {
    '.': './index.mjs',
    './client': './dist/client.js',
    './package.json': './package.json',
    './locale/*.json': './locale/*.json',
  }, 'Manifest exports must match the shipped plugin entrypoints');
  assert.equal(manifest.icon, './icon.svg');
  assert.equal(manifest.peerDependencies?.['@deepseek-ai/dsh'], '0.1.7-rc.2 || 0.2.0-rc.2');
  assert.equal(manifest.peerDependenciesMeta?.['@deepseek-ai/dsh']?.optional, true);
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.equal(manifest.dsh?.client?.platform, 'web');
  assert.equal(manifest.dsh?.client?.immediately, true);
  assert.deepEqual(manifest.dsh?.client?.inject, ['@deepseek-ai/dsh-client-ui-conversation']);
  assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0, 'Missing package files allowlist');

  // Deliberately accept only this small declarative YAML shape, not executable or
  // additional Cordis entries. No YAML dependency is needed for the fixed patch.
  const patch = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(patch, /^- insert:\n {4}- id: local-dsh-vcs\n {6}name: ['"]@feng0531\/dsh-vcs['"]\n {6}disabled: false\n {6}config: \{\}\n?$/, 'Unexpected Cordis installation patch');

  // Windows npm is a .cmd shim. Only literal command/arguments reach the shell;
  // neither package metadata nor user input is ever interpolated into it.
  const windows = process.platform === 'win32';
  const packed = spawnSync(windows ? 'cmd.exe' : 'npm',
    windows ? ['/d', '/s', '/c', 'npm.cmd pack --dry-run --ignore-scripts --json']
      : ['pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: root,
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  if (packed.error) throw packed.error;
  assert.equal(packed.status, 0, 'npm pack dry-run failed: ' + (packed.stderr || packed.signal || packed.status));
  const reports = parsePackReport(packed.stdout);
  assert.ok(Array.isArray(reports) && reports.length === 1, 'Expected exactly one package');
  const report = reports[0];
  assert.equal(report.name, manifest.name);
  assert.equal(report.version, manifest.version);
  assert.ok(Array.isArray(report.files) && report.files.length > 0, 'Missing packed file list');
  const paths = new Set();
  const allowed = new Set(required);
  for (const file of report.files) {
    const path = file.path;
    assert.equal(typeof path, 'string', 'Invalid packed path');
    assert.ok(!path.includes('\\') && !path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..'), 'Unsafe packed path: ' + path);
    assert.ok((['src/svn-identity.mjs','src/svn-target.mjs','src/svn-path.mjs','src/svn-revision.mjs'].includes(path)&&allowed.has(path))||!/(^|\/)(src|tests?|node_modules|\.git|\.github|secrets?)(\/|$)/i.test(path), 'Development/private directory packed: ' + path);
    assert.ok(!/(^|\/)(\.env(?:\..*)?|\.npmrc|\.netrc|credentials(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx))$/i.test(path), 'Potential secret packed: ' + path);
    assert.ok(allowed.has(path) || /^locale\/[a-zA-Z0-9_-]+\.json$/.test(path), 'Unexpected packed file: ' + path);
    assert.ok(!paths.has(path), 'Duplicate packed file: ' + path);
    assert.ok(Number.isSafeInteger(file.size) && file.size > 0, 'Empty or invalid packed file: ' + path);
    paths.add(path);
  }
  for (const path of required) assert.ok(paths.has(path), 'Required file missing from package: ' + path);
  for (const [key, target] of Object.entries(manifest.exports)) {
    if (!key.includes('*')) assert.ok(paths.has(target.slice(2)), 'Export target not packed: ' + target);
  }
  for (const path of paths) {
    if (path.startsWith('locale/')) JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));
  }
  assert.deepEqual(report.bundled ?? [], [], 'node_modules must not be bundled');
  console.log('Verified ' + manifest.name + '@' + manifest.version + ': ' + paths.size + ' packed files, exports, assets, notices and Cordis patch.');
}

try {
  verify();
} catch (error) {
  console.error('Package verification failed: ' + (error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}
