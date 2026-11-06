import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, realpath, readFile, writeFile, rm, lstat, link, symlink, rename} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {withOwnedIndexLock, MAX_INDEX_BYTES} from '../index-lock.mjs';

const old = Buffer.from('old raw index\0bytes');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const code = expected => error => error.code === expected;
const hooks = extra => ({assertAuthorized() {}, beforePublish() {}, onStart() {}, ...extra});
async function fixture(t) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'dsh-index-lock-'));
  t.after(() => rm(temporary, {recursive: true, force: true}));
  const root = await realpath(temporary);
  const gitDirectory = path.join(root, '.git');
  await mkdir(gitDirectory);
  const index = path.join(gitDirectory, 'index'), lock = path.join(gitDirectory, 'index.lock');
  await writeFile(index, old);
  return {root, gitDirectory, index, lock, options: {gitDirectory, expectedIndexDigest: sha(old)}};
}
async function absent(file) { await assert.rejects(lstat(file), code('ENOENT')); }
async function unchanged(f) { assert.deepEqual(await readFile(f.index), old); await absent(f.lock); }
async function optionalLink(t, make) {
  try { await make(); return true; }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('OS does not permit test link: ' + error.code); return false; } throw error; }
}

test('preexisting foreign lock is untouched and callback is never invoked', async t => {
  const f = await fixture(t); await writeFile(f.lock, 'foreign');
  await assert.rejects(withOwnedIndexLock(f.options, () => assert.fail('callback')), code('vcs/index-locked'));
  assert.equal(await readFile(f.lock, 'utf8'), 'foreign'); assert.deepEqual(await readFile(f.index), old);
});

test('strict expected SHA256 rejects malformed digests without locking', async t => {
  const f = await fixture(t);
  for (const expectedIndexDigest of ['', 'a'.repeat(63), 'g'.repeat(64), 'a'.repeat(64) + '\n', null, 1]) {
    await assert.rejects(withOwnedIndexLock({...f.options, expectedIndexDigest}, () => assert.fail('callback')), code('vcs/index-invalid'));
  }
  await unchanged(f);
});

test('stale expected digest leaves source unchanged', async t => {
  const f = await fixture(t);
  await assert.rejects(withOwnedIndexLock({...f.options, expectedIndexDigest: sha('stale')}, () => assert.fail('callback')), code('vcs/index-stale'));
  await unchanged(f);
});

test('read is copied, candidate stays private, result returned without implicit publish', async t => {
  const f = await fixture(t);
  const result = await withOwnedIndexLock(f.options, async ({readIndex, writeCandidate}) => {
    const first = await readIndex(); first.fill(0); assert.deepEqual(await readIndex(), old);
    await writeCandidate(Buffer.from('not published')); assert.deepEqual(await readFile(f.index), old);
    return 42;
  });
  assert.equal(result, 42); await unchanged(f);
});

test('explicit publish replaces atomically, truncates rewritten candidate, keeps new Index', async t => {
  const f = await fixture(t); const before = await lstat(f.index, {bigint: true}); const events = [];
  const result = await withOwnedIndexLock({...f.options, expectedIndexDigest: sha(old).toUpperCase()}, async ({writeCandidate, publish}) => {
    await writeCandidate(Buffer.from('a much longer candidate')); await writeCandidate(Buffer.from('new'));
    await publish(hooks({assertAuthorized() { events.push('auth'); }, async beforePublish() {
      assert.deepEqual(await readFile(f.index), old); assert.equal(await readFile(f.lock, 'utf8'), 'new'); events.push('before');
    }, onStart() { events.push('start'); }}));
    assert.equal(await readFile(f.index, 'utf8'), 'new'); await absent(f.lock); return 'published';
  });
  assert.equal(result, 'published'); assert.equal(await readFile(f.index, 'utf8'), 'new'); await absent(f.lock);
  assert.notEqual((await lstat(f.index, {bigint: true})).ino, before.ino);
  assert.deepEqual(events, ['auth', 'before', 'auth', 'start', 'auth', 'auth']);
});

test('abort before acquisition does not create lock or invoke callback', async t => {
  const f = await fixture(t); const controller = new AbortController(); controller.abort();
  await assert.rejects(withOwnedIndexLock({...f.options, signal: controller.signal}, () => assert.fail('callback')), {name: 'AbortError'});
  await unchanged(f);
});

test('abort inside callback cleans only private candidate', async t => {
  const f = await fixture(t); const controller = new AbortController();
  await assert.rejects(withOwnedIndexLock({...f.options, signal: controller.signal}, async ({writeCandidate}) => {
    await writeCandidate(Buffer.from('candidate')); controller.abort();
  }), {name: 'AbortError'}); await unchanged(f);
});

test('callback failure cleans owned lock and preserves original error', async t => {
  const f = await fixture(t); const error = new Error('work failed');
  await assert.rejects(withOwnedIndexLock(f.options, async ({writeCandidate}) => { await writeCandidate(Buffer.from('candidate')); throw error; }), e => e === error);
  await unchanged(f);
});

test('candidate accepts exact limit and empty, rejects oversize and non-Buffer', async t => {
  const f = await fixture(t);
  await withOwnedIndexLock(f.options, async ({writeCandidate}) => {
    await writeCandidate(Buffer.alloc(MAX_INDEX_BYTES, 7)); assert.equal((await lstat(f.lock)).size, MAX_INDEX_BYTES);
    await assert.rejects(writeCandidate(Buffer.alloc(MAX_INDEX_BYTES + 1)), code('vcs/index-too-large'));
    await assert.rejects(writeCandidate(new Uint8Array(1)), code('vcs/index-invalid'));
    await writeCandidate(Buffer.alloc(0)); assert.equal((await lstat(f.lock)).size, 0);
  }); await unchanged(f);
});

test('oversize live Index is rejected before callback or lock', async t => {
  const f = await fixture(t); const bytes = Buffer.alloc(MAX_INDEX_BYTES + 1); await writeFile(f.index, bytes);
  await assert.rejects(withOwnedIndexLock({...f.options, expectedIndexDigest: sha(bytes)}, () => assert.fail('callback')), code('vcs/index-too-large'));
  assert.deepEqual(await readFile(f.index), bytes); await absent(f.lock);
});

test('publish requires candidate and all explicit adapter hooks', async t => {
  const f = await fixture(t);
  await withOwnedIndexLock(f.options, async ({publish, writeCandidate}) => {
    await assert.rejects(publish(hooks()), code('vcs/index-state')); await writeCandidate(Buffer.from('new'));
    for (const missing of ['assertAuthorized', 'beforePublish', 'onStart']) await assert.rejects(publish({...hooks(), [missing]: undefined}), code('vcs/index-invalid'));
  }); await unchanged(f);
});

test('live Index CAS is rechecked after beforePublish hook', async t => {
  const f = await fixture(t); let started = false;
  await assert.rejects(withOwnedIndexLock(f.options, async ({writeCandidate, publish}) => {
    await writeCandidate(Buffer.from('candidate'));
    await publish(hooks({async beforePublish() { await writeFile(f.index, 'external change'); }, onStart() { started = true; }}));
  }), code('vcs/index-stale'));
  assert.equal(started, false); assert.equal(await readFile(f.index, 'utf8'), 'external change'); await absent(f.lock);
});

test('same-byte Index replacement is also rejected conservatively', async t => {
  const f = await fixture(t);
  await assert.rejects(withOwnedIndexLock(f.options, async ({writeCandidate, publish}) => {
    await writeCandidate(Buffer.from('candidate'));
    await publish(hooks({async beforePublish() { const replacement = path.join(f.gitDirectory, 'replacement'); await writeFile(replacement, old); await rename(replacement, f.index); }}));
  }), code('vcs/index-stale')); await unchanged(f);
});

test('replaced foreign lock is neither written nor deleted', async t => {
  const f = await fixture(t);
  await assert.rejects(withOwnedIndexLock(f.options, async ({writeCandidate}) => {
    await writeCandidate(Buffer.from('ours')); await rename(f.lock, path.join(f.gitDirectory, 'displaced'));
    await writeFile(f.lock, 'foreign'); await writeCandidate(Buffer.from('must not write'));
  }), code('vcs/index-unsafe'));
  assert.equal(await readFile(f.lock, 'utf8'), 'foreign'); assert.deepEqual(await readFile(f.index), old);
});

test('cleanup alone also leaves a replacement foreign lock untouched', async t => {
  const f = await fixture(t);
  await assert.rejects(withOwnedIndexLock(f.options, async () => {
    await rename(f.lock, path.join(f.gitDirectory, 'displaced')); await writeFile(f.lock, 'foreign');
  }), code('vcs/index-unsafe'));
  assert.equal(await readFile(f.lock, 'utf8'), 'foreign'); assert.deepEqual(await readFile(f.index), old);
});

test('publication rejects a swapped lock and leaves foreign bytes untouched', async t => {
  const f = await fixture(t); let started = false;
  await assert.rejects(withOwnedIndexLock(f.options, async ({writeCandidate, publish}) => {
    await writeCandidate(Buffer.from('ours'));
    await publish(hooks({async beforePublish() {
      await rename(f.lock, path.join(f.gitDirectory, 'displaced')); await writeFile(f.lock, 'foreign');
    }, onStart() { started = true; }}));
  }), code('vcs/index-unsafe'));
  assert.equal(started, false); assert.equal(await readFile(f.lock, 'utf8'), 'foreign'); assert.deepEqual(await readFile(f.index), old);
});

test('published cleanup leaves a newly created foreign lock untouched', async t => {
  const f = await fixture(t);
  await withOwnedIndexLock(f.options, async ({writeCandidate, publish}) => {
    await writeCandidate(Buffer.from('new')); await publish(hooks()); await writeFile(f.lock, 'foreign');
  });
  assert.equal(await readFile(f.index, 'utf8'), 'new'); assert.equal(await readFile(f.lock, 'utf8'), 'foreign');
});

test('hardlinked Index is rejected', async t => {
  const f = await fixture(t); if (!await optionalLink(t, () => link(f.index, path.join(f.root, 'index-link')))) return;
  await assert.rejects(withOwnedIndexLock(f.options, () => assert.fail('callback')), code('vcs/index-unsafe'));
  await unchanged(f);
});

test('hardlinked owned lock loses eligibility and neither link is deleted', async t => {
  const f = await fixture(t); let linked = false;
  try {
    await withOwnedIndexLock(f.options, async ({writeCandidate}) => {
      linked = await optionalLink(t, () => link(f.lock, path.join(f.root, 'lock-link')));
      if (linked) await writeCandidate(Buffer.from('no'));
    });
    assert.equal(linked, false);
  } catch (error) { assert.equal(error.code, 'vcs/index-unsafe'); assert.equal(linked, true); }
  assert.deepEqual(await readFile(f.index), old);
  if (linked) { assert.equal((await lstat(f.lock)).nlink, 2); assert.equal((await readFile(f.lock)).length, 0); }
});

test('symlink Index is rejected without touching target', async t => {
  const f = await fixture(t); const target = path.join(f.root, 'target'); await writeFile(target, old); await rm(f.index);
  if (!await optionalLink(t, () => symlink(target, f.index, 'file'))) return;
  await assert.rejects(withOwnedIndexLock(f.options, () => assert.fail('callback')), code('vcs/index-unsafe'));
  assert.deepEqual(await readFile(target), old); await absent(f.lock);
});

test('symlink metadata directory is rejected', async t => {
  const f = await fixture(t); const alias = path.join(f.root, 'alias');
  if (!await optionalLink(t, () => symlink(f.gitDirectory, alias, process.platform === 'win32' ? 'junction' : 'dir'))) return;
  await assert.rejects(withOwnedIndexLock({...f.options, gitDirectory: alias}, () => assert.fail('callback')), code('vcs/index-unsafe'));
  await unchanged(f);
});

test('preexisting symlink lock is untouched', async t => {
  const f = await fixture(t); const target = path.join(f.root, 'target'); await writeFile(target, 'foreign');
  if (!await optionalLink(t, () => symlink(target, f.lock, 'file'))) return;
  await assert.rejects(withOwnedIndexLock(f.options, () => assert.fail('callback')), code('vcs/index-locked'));
  assert.equal((await lstat(f.lock)).isSymbolicLink(), true); assert.equal(await readFile(target, 'utf8'), 'foreign');
});

test('pre-start authorization or cancellation failures preserve Index', async t => {
  for (const mode of ['authorization', 'abort']) {
    const f = await fixture(t); const controller = new AbortController(); let started = false;
    await assert.rejects(withOwnedIndexLock({...f.options, signal: controller.signal}, async ({writeCandidate, publish}) => {
      await writeCandidate(Buffer.from('new')); await publish(hooks({assertAuthorized() { if (mode === 'authorization') throw new Error('unauthorized'); },
        beforePublish() { controller.abort(); }, onStart() { started = true; }}));
    }), e => mode === 'abort' ? e.name === 'AbortError' : e.message === 'unauthorized');
    assert.equal(started, false); await unchanged(f);
  }
});

test('onStart error or abort is outcome unknown even before rename', async t => {
  for (const mode of ['throw', 'abort']) {
    const f = await fixture(t); const controller = new AbortController();
    await assert.rejects(withOwnedIndexLock({...f.options, signal: controller.signal}, async ({writeCandidate, publish}) => {
      await writeCandidate(Buffer.from('new')); await publish(hooks({onStart() { if (mode === 'throw') throw new Error('start'); controller.abort(); }}));
    }), code('vcs/index-outcome-unknown')); await unchanged(f);
  }
});

test('caught post-start publication failure still returns unknown', async t => {
  const f = await fixture(t);
  await assert.rejects(withOwnedIndexLock(f.options, async ({writeCandidate, publish}) => {
    await writeCandidate(Buffer.from('new'));
    await assert.rejects(publish(hooks({onStart() { throw new Error('start'); }})), /start/);
    return 'must not report success';
  }), code('vcs/index-outcome-unknown')); await unchanged(f);
});

test('post-rename authorization failure is unknown and published Index is not cleaned', async t => {
  const f = await fixture(t); let calls = 0;
  await assert.rejects(withOwnedIndexLock(f.options, async ({writeCandidate, publish}) => {
    await writeCandidate(Buffer.from('new')); await publish(hooks({assertAuthorized() { if (++calls === 3) throw new Error('revoked'); }}));
  }), code('vcs/index-outcome-unknown'));
  assert.equal(await readFile(f.index, 'utf8'), 'new'); await absent(f.lock);
});

test('callback cancellation or failure after successful rename is unknown', async t => {
  for (const mode of ['abort', 'throw']) {
    const f = await fixture(t); const controller = new AbortController();
    await assert.rejects(withOwnedIndexLock({...f.options, signal: controller.signal}, async ({writeCandidate, publish}) => {
      await writeCandidate(Buffer.from('new')); await publish(hooks());
      if (mode === 'abort') controller.abort(); else throw new Error('after rename');
    }), code('vcs/index-outcome-unknown'));
    assert.equal(await readFile(f.index, 'utf8'), 'new'); await absent(f.lock);
  }
});
