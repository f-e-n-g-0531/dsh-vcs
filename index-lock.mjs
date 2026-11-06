// Live Index locking only; intentionally not connected to an RPC or Git subprocess.
import {constants} from 'node:fs';
import {lstat, realpath, open, rename, unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {currentOperationBudget} from './src/operation-budget.mjs';

export const MAX_INDEX_BYTES = 8 * 1024 * 1024;
const failure = (code, message, cause) => Object.assign(new Error(message, {cause}), {code});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const plain = stat => stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n;
const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
const unsafe = message => failure('vcs/index-unsafe', message);

/**
 * Lock an existing, upstream-validated embedded metadata directory and live Index.
 * expectedIndexDigest is a strict 64-hex SHA256 of the complete raw Index (<=8MiB).
 * Returns work's result. work receives async readIndex(), writeCandidate(Buffer),
 * and publish({assertAuthorized, beforePublish, onStart}); await every operation.
 * readIndex returns an independent copy of the original bytes. Candidate writes
 * never modify index. publish requires all three adapter-owned hooks, checks CAS,
 * then marks publishStarted, calls onStart, and attempts exactly one same-directory
 * rename. beforePublish is an awaited pre-start hook, not an authorization bypass.
 * Authorization and cancellation are rechecked after rename and after work.
 * Any error after publishStarted is vcs/index-outcome-unknown, even if rename
 * failed: refresh state, do not retry blindly. There is no automatic publication.
 *
 * No symlinks, multi-link files, missing Index, noncanonical directory aliases,
 * or preexisting locks are accepted. Identity checks are conservative checks, NOT
 * global atomicity or isolation against arbitrary malicious concurrent FS edits.
 * A replacement lock is never intentionally deleted. No old Index unlink/retry.
 */
export async function withOwnedIndexLock({gitDirectory, expectedIndexDigest, signal} = {}, work) {
  if (typeof expectedIndexDigest !== 'string' || !/^[a-fA-F0-9]{64}$/.test(expectedIndexDigest)) {
    throw failure('vcs/index-invalid', 'expectedIndexDigest must be exactly 64 hexadecimal characters.');
  }
  if (typeof gitDirectory !== 'string' || !path.isAbsolute(gitDirectory) || typeof work !== 'function') {
    throw failure('vcs/index-invalid', 'An absolute canonical gitDirectory and work callback are required.');
  }
  const budget = currentOperationBudget();
  const checkAbort = () => { signal?.throwIfAborted(); budget?.throwIfExpired(); };
  checkAbort();
  const directory = path.resolve(gitDirectory);
  const directoryStat = await lstat(directory, {bigint: true});
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() ||
      normalized(await realpath(directory)) !== normalized(directory)) throw unsafe('Metadata directory must be canonical and not a link.');
  const indexPath = path.join(directory, 'index');
  const lockPath = path.join(directory, 'index.lock');
  const verifyDirectory = async () => {
    const current = await lstat(directory, {bigint: true});
    if (!current.isDirectory() || current.isSymbolicLink() || !same(current, directoryStat) ||
        normalized(await realpath(directory)) !== normalized(directory)) throw unsafe('Metadata directory identity changed.');
  };
  const readLive = async () => {
    await verifyDirectory();
    const entry = await lstat(indexPath, {bigint: true});
    if (!plain(entry)) throw unsafe('Index must be a plain single-link file.');
    if (entry.size > BigInt(MAX_INDEX_BYTES)) throw failure('vcs/index-too-large', 'Index exceeds 8MiB.');
    const handle = await open(indexPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const opened = await handle.stat({bigint: true});
      if (!plain(opened) || !same(entry, opened)) throw unsafe('Index identity changed while opening.');
      const buffer = Buffer.alloc(MAX_INDEX_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        checkAbort();
        const {bytesRead} = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > MAX_INDEX_BYTES) throw failure('vcs/index-too-large', 'Index exceeds 8MiB.');
      const after = await handle.stat({bigint: true});
      const current = await lstat(indexPath, {bigint: true});
      if (!plain(after) || !plain(current) || !same(opened, current) ||
          after.size !== BigInt(length) || opened.size !== after.size ||
          opened.mtimeNs !== after.mtimeNs || opened.ctimeNs !== after.ctimeNs) throw unsafe('Index changed while reading.');
      await verifyDirectory();
      return {bytes: Buffer.from(buffer.subarray(0, length)), stat: after};
    } finally { await handle.close(); }
  };
  const original = await readLive();
  const expected = expectedIndexDigest.toLowerCase();
  if (digest(original.bytes) !== expected) throw failure('vcs/index-stale', 'Live Index does not match the expected digest.');
  checkAbort();
  await verifyDirectory();
  let handle;
  try {
    handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW || 0), 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw failure('vcs/index-locked', 'An Index lock already exists; it was not touched.', error);
    throw error;
  }
  let owned, candidateReady = false, publishStarted = false, published = false;
  let active = true, pending = null, authorization, publishError, candidateDigest, candidateLength;
  const verifyOwned = async () => {
    await verifyDirectory();
    const current = await lstat(lockPath, {bigint: true});
    const opened = await handle.stat({bigint: true});
    if (!owned || !plain(current) || !plain(opened) || !same(current, owned) || !same(opened, owned)) {
      throw unsafe('Index lock ownership changed.');
    }
  };
  const checkLive = async () => {
    const live = await readLive();
    if (!same(live.stat, original.stat) || digest(live.bytes) !== expected) {
      throw failure('vcs/index-stale', 'Live Index changed before publication.');
    }
  };
  const verifyCandidate = async () => {
    await verifyOwned();
    const before = await handle.stat({bigint: true});
    if (before.size !== BigInt(candidateLength)) throw unsafe('Candidate content changed.');
    const bytes = Buffer.alloc(candidateLength); let offset = 0;
    while (offset < bytes.length) {
      checkAbort();
      const {bytesRead} = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw unsafe('Candidate content truncated.');
      offset += bytesRead;
    }
    const after = await handle.stat({bigint: true});
    if (before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || digest(bytes) !== candidateDigest) throw unsafe('Candidate content changed.');
    await verifyOwned();
  };
  const verifyPublished = async () => {
    const live = await readLive();
    if (!same(live.stat, owned) || live.bytes.length !== candidateLength || digest(live.bytes) !== candidateDigest) throw unsafe('Published Index no longer matches the approved candidate.');
  };
  const operation = task => {
    if (!active || publishStarted || pending) return Promise.reject(failure('vcs/index-state', 'Index lock operation is closed, published, or busy.'));
    const result = (async () => { checkAbort(); await verifyOwned(); return task(); })();
    pending = result;
    // Observe rejection even if a callback forgets to await an operation.
    result.then(() => { if (pending === result) pending = null; }, caught => {
      if (publishStarted) publishError ||= caught || failure('vcs/index-operation', 'Publication failed.');
      if (pending === result) pending = null;
    });
    return result;
  };
  let result, error;
  try {
    owned = await handle.stat({bigint: true});
    await verifyOwned();
    result = await work(Object.freeze({
      readIndex: () => operation(async () => Buffer.from(original.bytes)),
      writeCandidate: bytes => {
        if (!Buffer.isBuffer(bytes)) return Promise.reject(failure('vcs/index-invalid', 'Candidate must be a Buffer.'));
        if (bytes.length > MAX_INDEX_BYTES) return Promise.reject(failure('vcs/index-too-large', 'Candidate exceeds 8MiB.'));
        const captured = Buffer.from(bytes);
        return operation(async () => {
        if (!Buffer.isBuffer(bytes)) throw failure('vcs/index-invalid', 'Candidate must be a Buffer.');
        if (bytes.length > MAX_INDEX_BYTES) throw failure('vcs/index-too-large', 'Candidate exceeds 8MiB.');
        const candidate = captured;
        candidateReady = false;
        let offset = 0;
        while (offset < candidate.length) {
          checkAbort();
          await verifyOwned();
          const {bytesWritten} = await handle.write(candidate, offset, candidate.length - offset, offset);
          if (!Number.isInteger(bytesWritten) || bytesWritten <= 0) throw failure('vcs/index-write', 'Candidate write made no progress.');
          offset += bytesWritten;
        }
        checkAbort();
        await verifyOwned();
        await handle.truncate(candidate.length);
        await handle.sync();
        await verifyOwned();
        checkAbort();
        candidateDigest = digest(candidate); candidateLength = candidate.length;
        await verifyCandidate();
        candidateReady = true;
        });
      },
      publish: hooks => operation(async () => {
        if (!candidateReady) throw failure('vcs/index-state', 'Write a complete candidate before publishing.');
        if (!hooks || ['assertAuthorized', 'beforePublish', 'onStart'].some(key => typeof hooks[key] !== 'function')) {
          throw failure('vcs/index-invalid', 'Publish requires assertAuthorized, beforePublish and onStart callbacks.');
        }
        authorization = hooks.assertAuthorized;
        await authorization();
        checkAbort();
        await hooks.beforePublish();
        await authorization();
        checkAbort();
        await checkLive();
        await verifyCandidate();
        checkAbort();
        publishStarted = true;
        // Synchronous notification: the future adapter must not start asynchronous work here.
        const notification = hooks.onStart();
        if (notification && typeof notification.then === 'function') {
          await notification;
          throw failure('vcs/index-invalid', 'onStart must be synchronous.');
        }
        checkAbort();
        await verifyCandidate();
        await checkLive();
        checkAbort();
        await rename(lockPath, indexPath);
        published = true;
        await authorization();
        await verifyPublished();
        checkAbort();
      }),
    }));
    active = false;
    if (pending) await pending;
    if (published) { await authorization(); await verifyPublished(); }
    checkAbort();
  } catch (caught) { error = caught || failure('vcs/index-operation', 'Index callback failed.'); }
  finally {
    active = false;
    if (pending) { try { await pending; } catch (caught) { error ||= caught; } }
    if (!published && owned) {
      try {
        await verifyOwned();
        await unlink(lockPath);
      } catch (caught) {
        // Ownership loss is itself an error, but never permission to unlink a foreign lock.
        error ||= caught;
      }
    }
    try { await handle.close(); } catch (caught) { error ||= caught; }
  }
  error ||= publishError;
  if (error) {
    if (publishStarted) throw failure('vcs/index-outcome-unknown', 'Index publication started; refresh repository state before any further action.', error);
    throw error;
  }
  return result;
}
