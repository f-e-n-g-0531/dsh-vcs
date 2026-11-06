import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm, realpath} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {git} from '../local-command.mjs';
import {createHandler} from '../index.mjs';

// Snapshot every object-store entry, not merely reachable object IDs. File
// identity/version checks detect rewrites with equal bytes; atime is excluded.
async function objectsSnapshot(root) {
  const rows = [];
  async function visit(relative) {
    const absolute = path.join(root, '.git', 'objects', relative);
    const stat = await lstat(absolute, {bigint: true});
    assert.equal(stat.isSymbolicLink(), false);
    const version = ['dev', 'ino', 'mode', 'nlink', 'size', 'birthtimeNs', 'mtimeNs', 'ctimeNs']
      .map(key => String(stat[key]));
    if (stat.isDirectory()) {
      rows.push({path: relative, type: 'directory', version});
      for (const name of (await readdir(absolute)).sort()) await visit(path.join(relative, name));
    } else {
      assert.equal(stat.isFile(), true);
      rows.push({path: relative, type: 'file', version, bytes: await readFile(absolute)});
    }
  }
  await visit('');
  return rows;
}

async function fixture(t, objectFormat) {
  const temp = await mkdtemp(path.join(tmpdir(), 'lightweight-rpc-integration-'));
  const root = await realpath(temp);
  t.after(() => rm(root, {recursive: true, force: true}));
  const spawn = cp.spawn;
  // local-command deliberately strips inherited GIT_* variables; inject at the
  // same actual spawn boundary as the existing real-RPC test, not into the API.
  cp.spawn = (command, args, options) => spawn(command, args, {
    ...options,
    env: {...options.env, GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: path.join(root, 'absent-global'),
      GIT_CONFIG_SYSTEM: path.join(root, 'absent-system')},
  });
  syncBuiltinESMExports();
  t.after(() => { cp.spawn = spawn; syncBuiltinESMExports(); });
  const run = (...args) => git(root, args);
  const text = async (...args) => (await run(...args)).toString().trim();
  const template = path.join(root, 'empty-template');
  await mkdir(template);
  await run('init', '--object-format=' + objectFormat, '--initial-branch=main', '--template=' + template);
  await run('config', '--local', 'user.name', 'Integration Test');
  await run('config', '--local', 'user.email', 'integration@example.invalid');
  await run('config', '--local', 'core.autocrlf', 'false');
  await writeFile(path.join(root, 'tracked.txt'), 'committed\n');
  await run('add', '--', 'tracked.txt');
  await run('commit', '-m', 'baseline');
  const head = await text('rev-parse', 'HEAD');
  assert.equal(head.length, objectFormat === 'sha1' ? 40 : 64);
  assert.equal(await text('rev-parse', '--show-object-format'), objectFormat);
  await writeFile(path.join(root, 'tracked.txt'), 'staged\n');
  await run('add', '--', 'tracked.txt');
  await writeFile(path.join(root, 'tracked.txt'), Buffer.from('dirty work\r\n\0bytes'));
  await writeFile(path.join(root, 'untracked.bin'), Buffer.from([0, 255, 13, 10, 1]));
  const headFile = await readFile(path.join(root, '.git', 'HEAD'));
  const index = await readFile(path.join(root, '.git', 'index'));
  const dirty = await readFile(path.join(root, 'tracked.txt'));
  const untracked = await readFile(path.join(root, 'untracked.bin'));
  const unchanged = async () => {
    assert.equal(await text('rev-parse', 'HEAD'), head);
    assert.deepEqual(await readFile(path.join(root, '.git', 'HEAD')), headFile);
    assert.deepEqual(await readFile(path.join(root, '.git', 'index')), index);
    assert.deepEqual(await readFile(path.join(root, 'tracked.txt')), dirty);
    assert.deepEqual(await readFile(path.join(root, 'untracked.bin')), untracked);
  };
  // No adapter, prepare/apply or authorization mocks: default API + session cwd.
  const handle = createHandler({sessions: {get: () => ({header: {cwd: root}})}});
  t.after(() => handle.dispose());
  const request = (endpoint, payload = {}) => handle(endpoint, {sessionId: 'integration', ...payload});
  const call = async (endpoint, payload) => {
    const response = await request(endpoint, payload);
    assert.equal(response.ok, true, JSON.stringify({endpoint, response}));
    return response.value;
  };
  const found = await call('vcs/repositories', {});
  const repository = found.repositories.find(candidate => candidate.type === 'git');
  assert.ok(repository);
  return {root, head, run, text, unchanged, request, call, repositoryId: repository.id};
}

for (const objectFormat of ['sha1', 'sha256']) {
  test(objectFormat + ': real default RPC creates a direct lightweight ref without object or worktree writes', {concurrency: false}, async t => {
    const f = await fixture(t, objectFormat);
    const name = 'release/integration', ref = 'refs/tags/' + name;
    const before = await objectsSnapshot(f.root);
    // Apart from the session/repository address, preparation accepts name only.
    const preview = await f.call('vcs/lightweight-tag-prepare', {repositoryId: f.repositoryId, name});
    assert.equal(preview.head, f.head);
    assert.equal(preview.ref, ref);
    assert.equal(preview.objectFormat, objectFormat);
    assert.deepEqual(await objectsSnapshot(f.root), before, 'prepare must not write objects');
    await f.unchanged();
    const confirmation = {repositoryId: f.repositoryId, token: preview.token};
    const result = await f.call('vcs/lightweight-tag-confirm', confirmation);
    assert.equal(result.commit, f.head);
    assert.equal(result.ref, ref);
    assert.equal(await f.text('rev-parse', '--verify', ref), f.head);
    assert.equal(await f.text('cat-file', '-t', ref), 'commit', 'not an annotated tag object');
    assert.equal(await f.text('rev-parse', '--verify', ref + '^{}'), f.head);
    assert.deepEqual(await objectsSnapshot(f.root), before, 'confirm creates no objects or rewrites');
    await f.unchanged();
    const replay = await f.request('vcs/lightweight-tag-confirm', confirmation);
    assert.equal(replay.ok, false);
    assert.equal(replay.error.code, 'vcs/lightweight-tag-create-confirmation-invalid');
    assert.equal(await f.text('rev-parse', '--verify', ref), f.head);
    assert.deepEqual(await objectsSnapshot(f.root), before);
    await f.unchanged();
  });

  test(objectFormat + ': external target ref creation rejects before start and burns the capability', {concurrency: false}, async t => {
    const f = await fixture(t, objectFormat);
    const name = 'release/competitor', ref = 'refs/tags/' + name;
    // Create the competitor object before the object baseline without moving
    // HEAD, staging dirty bytes, or requiring hooks/signing/global configuration.
    const tree = await f.text('rev-parse', f.head + '^{tree}');
    const competitor = await f.text('commit-tree', tree, '-p', f.head, '-m', 'external competitor');
    assert.notEqual(competitor, f.head);
    const before = await objectsSnapshot(f.root);
    const preview = await f.call('vcs/lightweight-tag-prepare', {repositoryId: f.repositoryId, name});
    assert.equal(preview.head, f.head);
    await f.run('update-ref', ref, competitor, '0'.repeat(f.head.length));
    const competitorBytes = await readFile(path.join(f.root, '.git', ...ref.split('/')));
    const confirmation = {repositoryId: f.repositoryId, token: preview.token};
    const rejected = await f.request('vcs/lightweight-tag-confirm', confirmation);
    assert.equal(rejected.ok, false);
    assert.equal(typeof rejected.error.code, 'string');
    assert.notEqual(rejected.error.code, 'vcs/lightweight-tag-create-outcome-unknown', 'known pre-start rejection');
    assert.notEqual(rejected.error.code, 'vcs/lightweight-tag-create-confirmation-invalid', 'first attempt consumes a live token');
    assert.equal(await f.text('rev-parse', '--verify', ref), competitor, 'never overwrite competitor');
    assert.deepEqual(await readFile(path.join(f.root, '.git', ...ref.split('/'))), competitorBytes);
    assert.deepEqual(await objectsSnapshot(f.root), before);
    await f.unchanged();
    // Explicit adversarial replay, not an automatic retry: the consumed grant
    // must never restart the operation even though the competitor still exists.
    const replay = await f.request('vcs/lightweight-tag-confirm', confirmation);
    assert.equal(replay.ok, false);
    assert.equal(replay.error.code, 'vcs/lightweight-tag-create-confirmation-invalid');
    assert.equal(await f.text('rev-parse', '--verify', ref), competitor);
    assert.deepEqual(await readFile(path.join(f.root, '.git', ...ref.split('/'))), competitorBytes);
    assert.deepEqual(await objectsSnapshot(f.root), before);
    await f.unchanged();
  });
}
