import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { discoverRepositories, detectRepository, listChanges } from '../vcs.mjs';

function cmd(cwd, name, args) {
  const result = spawnSync(name, args, { cwd, windowsHide: true, shell: false, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } });
  assert.equal(result.status, 0, name + ': ' + (result.error || result.stderr));
}
async function temp(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-discovery-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5 }));
  return fs.realpath(root);
}
async function git(root) {
  await fs.mkdir(root, { recursive: true });
  cmd(root, 'git', ['init', '-b', 'main']);
  return fs.realpath(root);
}
async function svn(storage, wc) {
  await fs.mkdir(storage, { recursive: true });
  cmd(storage, 'svnadmin', ['create', path.join(storage, 'repository')]);
  cmd(storage, 'svn', ['checkout', pathToFileURL(path.join(storage, 'repository')).href, wc, '--non-interactive']);
  return fs.realpath(wc);
}
function keys(result) { return result.repositories.map(r => r.type + ':' + r.relativePath).sort(); }

test('multiple nested and mixed Git/SVN, same-root types, dedup and stable opaque IDs', async t => {
  const root = await temp(t), store = await temp(t);
  const mixed = await svn(store, path.join(root, 'mixed'));
  await git(mixed);
  await git(path.join(mixed, 'nested-git'));
  await svn(await temp(t), path.join(root, 'other-svn'));
  await git(path.join(root, 'other-git'));
  const result = await discoverRepositories(root);
  assert.deepEqual(keys(result), ['git:mixed', 'git:mixed/nested-git', 'git:other-git', 'svn:mixed', 'svn:other-svn']);
  assert.equal(result.truncated, false); assert.deepEqual(result.warnings, []);
  assert.equal(new Set(result.repositories.map(r => r.id)).size, 5);
  for (const r of result.repositories) { assert.match(r.id, /^[a-f0-9]{64}$/); assert.equal(r.root, await fs.realpath(r.root)); if (r.type === 'git') assert.equal(r.branch, 'main'); }
  const repeated = await discoverRepositories(root);
  assert.deepEqual(repeated.repositories.map(r => r.id).sort(), result.repositories.map(r => r.id).sort());
  const sameRoot = await discoverRepositories(mixed);
  assert.deepEqual(keys(sameRoot), ['git:.', 'git:nested-git', 'svn:.']);
  assert.equal((await detectRepository(mixed)).type, 'git'); // legacy priority preserved
  await listChanges(sameRoot.repositories.find(r => r.type === 'svn')); // selected SVN remains usable
});

test('nearest enclosing Git and SVN are found independently; outer Git is not duplicated', async t => {
  const root = await temp(t), outer = await git(path.join(root, 'outer'));
  const mixed = await svn(await temp(t), path.join(outer, 'wc'));
  const inner = await git(path.join(mixed, 'inner'));
  const cwd = path.join(inner, 'plain'); await fs.mkdir(cwd);
  const result = await discoverRepositories(cwd);
  assert.deepEqual(keys(result), ['git:..', 'svn:../..']);
  assert.equal(result.repositories.find(r => r.type === 'git').root, inner);
  assert.equal(result.truncated, false);
});

test('Git .git file worktrees and detached HEAD are discovered', async t => {
  const root = await temp(t), main = await git(path.join(root, 'main'));
  cmd(main, 'git', ['-c', 'user.name=Discovery', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'fixture', '--no-gpg-sign']);
  const linked = path.join(root, 'linked'); cmd(main, 'git', ['worktree', 'add', '--detach', linked]);
  assert.equal((await fs.stat(path.join(linked, '.git'))).isFile(), true);
  const result = await discoverRepositories(root);
  assert.deepEqual(keys(result), ['git:linked', 'git:main']);
  assert.match(result.repositories.find(r => r.relativePath === 'linked').branch, /^[a-f0-9]+$/);
  assert.equal(result.truncated, false);
});

test('depth, directory and repository bounds report incomplete scans', async t => {
  const root = await temp(t);
  await git(path.join(root, 'a')); await git(path.join(root, 'b')); await git(path.join(root, 'a', 'deep'));
  const depth = await discoverRepositories(root, { maxDepth: 1 });
  assert.deepEqual(keys(depth), ['git:a', 'git:b']); assert.equal(depth.truncated, true); assert.match(depth.warnings.join(), /Depth limit/);
  const directories = await discoverRepositories(root, { maxDirectories: 1 });
  assert.deepEqual(directories.repositories, []); assert.equal(directories.truncated, true); assert.match(directories.warnings.join(), /Directory limit/);
  const repos = await discoverRepositories(root, { maxRepositories: 1 });
  assert.equal(repos.repositories.length, 1); assert.equal(repos.truncated, true); assert.match(repos.warnings.join(), /Repository limit/);
  assert.equal((await discoverRepositories(root, { maxRepositories: 0 })).repositories.length, 0);
  const zeroDepth = await discoverRepositories(path.join(root, 'b'), { maxDepth: 0 });
  assert.deepEqual(keys(zeroDepth), ['git:.']); assert.equal(zeroDepth.truncated, false);
});

test('dependency/cache directories and symlinks/junctions are not descended', async t => {
  const root = await temp(t), outside = await git(await temp(t));
  for (const name of ['node_modules', '.cache', 'vendor', '.venv', '.yarn']) await git(path.join(root, name, 'hidden'));
  await git(path.join(root, 'visible'));
  const link = path.join(root, 'external');
  try { await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.skip('Symlink privilege unavailable'); return; } throw e; }
  await fs.symlink(root, path.join(root, 'cycle'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await discoverRepositories(root);
  assert.deepEqual(keys(result), ['git:visible']); assert.equal(result.truncated, false);
  await assert.rejects(discoverRepositories(root, { subdirectory: 'external' }), /symlink|junction|escapes/);
  await assert.rejects(discoverRepositories(root, { subdirectory: 'cycle/visible' }), /symlink|junction|escapes/);
});

test('targeted subdirectory scans exclude siblings and validate all path forms', async t => {
  const root = await temp(t); await git(path.join(root, 'a', 'nested')); await git(path.join(root, 'b'));
  const result = await discoverRepositories(root, { subdirectory: 'a' });
  assert.deepEqual(keys(result), ['git:a/nested']); assert.equal(result.truncated, false);
  for (const subdirectory of ['', '..', '../outside', 'a/../b', 'a\\..\\b', '/tmp', 'C:\\outside', 'C:outside', '\\\\server\\share', 'a\0b', 123]) {
    await assert.rejects(discoverRepositories(root, { subdirectory }), /Invalid discovery subdirectory/);
  }
  await fs.writeFile(path.join(root, 'file'), '');
  await assert.rejects(discoverRepositories(root, { subdirectory: 'file' }), /directory/);
  await assert.rejects(discoverRepositories(root, { subdirectory: 'missing' }), /ENOENT/);
  for (const options of [{ maxDepth: -1 }, { maxDirectories: Infinity }, { maxRepositories: 0.5 }, { timeoutMs: NaN }]) await assert.rejects(discoverRepositories(root, options), /Invalid discovery option/);
});

test('cancelled and expired requests return bounded partial results with warnings', async t => {
  const root = await temp(t); await git(path.join(root, 'repo'));
  const cancelled = await discoverRepositories(root, { signal: AbortSignal.abort() });
  assert.deepEqual(cancelled.repositories, []); assert.equal(cancelled.truncated, true); assert.match(cancelled.warnings.join(), /cancelled/);
  const expired = await discoverRepositories(root, { timeoutMs: 0 });
  assert.deepEqual(expired.repositories, []); assert.equal(expired.truncated, true); assert.match(expired.warnings.join(), /timed out/);
  const controller = new AbortController();
  // Abort after a real child command subscribes, not after a wall-clock delay:
  // a fast runner can finish the entire scan within 20ms.
  let subscribed = false;
  const signal = {
    get aborted() { return controller.signal.aborted; },
    addEventListener(...args) {
      controller.signal.addEventListener(...args);
      subscribed = true;
      queueMicrotask(() => controller.abort());
    },
    removeEventListener(...args) { controller.signal.removeEventListener(...args); },
  };
  const result = await discoverRepositories(root, { signal });
  assert.equal(subscribed, true);
  assert.equal(result.truncated, true);
  assert.match(result.warnings.join(), /cancelled/);
});

test('issued canonical roots reject subsequent symlink/junction replacement for both types', async t => {
  for (const type of ['git', 'svn']) {
    const root = await temp(t), issued = path.join(root, 'issued'), replacement = path.join(root, 'replacement');
    if (type === 'git') { await git(issued); await git(replacement); }
    else { await svn(await temp(t), issued); await svn(await temp(t), replacement); }
    const repo = (await discoverRepositories(issued)).repositories.find(r => r.type === type);
    assert.ok(repo);
    await fs.rename(issued, path.join(root, 'original'));
    try { await fs.symlink(replacement, issued, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.skip('Symlink privilege unavailable'); return; } throw e; }
    await assert.rejects(listChanges(repo), /Repository root changed or is invalid/);
  }
});

test('invalid repository markers warn without hiding valid neighboring repositories', async t => {
  const root = await temp(t);
  await git(path.join(root, 'valid'));
  await fs.mkdir(path.join(root, 'broken'));
  await fs.writeFile(path.join(root, 'broken', '.git'), 'not a git file');
  const result = await discoverRepositories(root);
  assert.deepEqual(keys(result), ['git:valid']); assert.equal(result.truncated, true);
  assert.match(result.warnings.join(), /Cannot inspect git repository/);
});

test('missing executables warn instead of returning a pretend complete empty scan', async t => {
  const root = await temp(t);
  // This file runs in its own node:test process; restore the environment immediately.
  const keys = Object.keys(process.env).filter(k => k.toLowerCase() === 'path');
  const saved = keys.map(k => [k, process.env[k]]);
  try {
    for (const k of keys) process.env[k] = root;
    const result = await discoverRepositories(root);
    assert.deepEqual(result.repositories, []); assert.equal(result.truncated, true);
    assert.match(result.warnings.join(), /git executable is unavailable/);
    assert.match(result.warnings.join(), /svn executable is unavailable/);
  } finally { for (const [k, value] of saved) process.env[k] = value; }
});
