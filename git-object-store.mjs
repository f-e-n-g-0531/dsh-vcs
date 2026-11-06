// Internal append-only primitive. No RPC, subprocess, Index, refs or worktree writes.
import {constants} from 'node:fs';
import {lstat, realpath, open, mkdir, link, unlink} from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {deflateSync, inflateSync} from 'node:zlib';
import {currentOperationBudget} from './src/operation-budget.mjs';

export const MAX_TREE_BYTES = 8 * 1024 * 1024;
export const MAX_COMMIT_BYTES = 128 * 1024;
export const MAX_TAG_BYTES = 128 * 1024;
const COMPRESSED_OVERHEAD_BYTES = 1024 * 1024;
const fail = (kind, message, cause) => Object.assign(new Error(message, {cause}), {code:'vcs/object-' + kind});
const same = (a,b) => a.dev === b.dev && a.ino === b.ino;
const plain = s => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n;
const normalized = p => process.platform === 'win32' ? p.toLowerCase() : p;
const hash = (format, bytes) => createHash(format).update(bytes).digest('hex');

/**
 * Capture a Buffer synchronously before the first await, then store its exact Git
 * tree, commit or tag representation. Returns {oid,created}; sha1 and sha256 are the only formats.
 * The caller supplies an already validated embedded canonical .git directory and
 * mandatory authorization and synchronous onStart callbacks. onStart precedes even
 * fanout mkdir; an already-valid existing object returns without onStart (read-only).
 * All errors after that notification are append-only outcome-unknown;
 * a published object is NEVER removed, including after cancellation/revocation.
 * Bodies are opaque: callers validate tree/commit/tag semantics, including referenced
 * object existence/types. Storage checks only exact type/length/header/bytes/hash.
 * Tree bodies are bounded to 8MiB, commits and tags to 128KiB, compressed bytes to the
 * applicable body bound plus 1MiB. No blob API is provided by this module.
 * Existing loose objects must be plain single-link files with bounded compressed
 * and inflated size and exact raw content/hash. Packed-only objects are not read:
 * creating a correct loose duplicate is safe. Alternates are not supported.
 *
 * Requires local filesystem exclusive-create and atomic hardlink NOREPLACE
 * semantics. Unsupported hardlinks fail closed (no rename/copy fallback). Identity
 * checks are conservative, not isolation against malicious concurrent directory
 * replacement; Node has no portable dirfd-relative filesystem transaction. Caller
 * must exclude hostile filesystem mutation. File sync is attempted, but directory
 * fsync/crash durability and network filesystem semantics are NOT guaranteed.
 */
export async function storeCapturedObject({gitDirectory, objectFormat, type, bytes, signal, assertAuthorized, onStart} = {}) {
  // Destructured type is an immutable primitive captured before any callback/await.
  if (type !== 'tree' && type !== 'commit' && type !== 'tag') throw fail('invalid','Only explicit tree, commit or tag types are supported.');
  const maxBodyBytes = type === 'tree' ? MAX_TREE_BYTES : type === 'commit' ? MAX_COMMIT_BYTES : MAX_TAG_BYTES;
  const maxLooseBytes = maxBodyBytes + COMPRESSED_OVERHEAD_BYTES;
  if (!Buffer.isBuffer(bytes)) throw fail('invalid','bytes must be a Buffer.');
  if (bytes.length > maxBodyBytes) throw fail('too-large','Object body exceeds its type bound.');
  const captured = Buffer.from(bytes); // Do not move below any await/callback.
  if (!['sha1','sha256'].includes(objectFormat) || typeof gitDirectory !== 'string' ||
      !path.isAbsolute(gitDirectory) || path.basename(gitDirectory) !== '.git' ||
      typeof assertAuthorized !== 'function' || typeof onStart !== 'function') {
    throw fail('invalid','Canonical embedded .git, exact objectFormat and authorization/start callbacks are required.');
  }
  const budget = currentOperationBudget();
  const check = () => { signal?.throwIfAborted(); budget?.throwIfExpired(); };
  const authorize = async () => { check(); await assertAuthorized(); check(); };
  const directory = path.resolve(gitDirectory), objects = path.join(directory,'objects');
  if(normalized(directory) !== normalized(gitDirectory))throw fail('unsafe','gitDirectory must be canonical, not a path alias.');
  const raw = Buffer.concat([Buffer.from(type + ' ' + captured.length + '\0'),captured]);
  const oid = hash(objectFormat,raw), fanout = path.join(objects,oid.slice(0,2)), target = path.join(fanout,oid.slice(2));
  let started = false, handle, owned, temporary;
  const directories = new Map();
  const verifyDirectory = async p => {
    check();
    const s = await lstat(p,{bigint:true});
    if (!s.isDirectory() || s.isSymbolicLink() || normalized(await realpath(p)) !== normalized(p) ||
        (directories.has(p) && !same(directories.get(p),s))) throw fail('unsafe','Noncanonical or changed object directory.');
    directories.set(p,s);
  };
  const absent = async p => {
    try { await lstat(p); } catch(e) { if(e.code === 'ENOENT')return; throw e; }
    throw fail('unsafe','Alternate or shared object storage is unsupported.');
  };
  const verifyStorage = async () => {
    await verifyDirectory(directory); await verifyDirectory(objects);
    await absent(path.join(directory,'commondir'));
    const info = path.join(objects,'info');
    try { await verifyDirectory(info); } catch(e) { if(e.code !== 'ENOENT')throw e; }
    await absent(path.join(info,'alternates')); await absent(path.join(info,'http-alternates'));
    check();
  };
  const validateExisting = async () => {
    await verifyStorage(); await verifyDirectory(fanout);
    let entry;
    try { entry = await lstat(target,{bigint:true}); } catch(e) { if(e.code === 'ENOENT')return false; throw e; }
    if(!plain(entry))throw fail('unsafe','Object must be a plain single-link file.');
    if(entry.size > BigInt(maxLooseBytes))throw fail('corrupt','Compressed object exceeds bound.');
    const file = await open(target,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const before = await file.stat({bigint:true});
      if(!plain(before) || !same(entry,before))throw fail('unsafe','Object identity changed while opening.');
      if(before.size > BigInt(maxLooseBytes))throw fail('corrupt','Compressed object exceeds bound.');
      const buffer = Buffer.alloc(Number(before.size) + 1); let length = 0;
      while(length < buffer.length) {
        check(); const {bytesRead} = await file.read(buffer,length,buffer.length-length,length);
        if(!bytesRead)break; length += bytesRead;
      }
      const after = await file.stat({bigint:true}), current = await lstat(target,{bigint:true});
      if(!plain(after) || !plain(current) || !same(before,current) || length !== Number(before.size) ||
          before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs)throw fail('unsafe','Object changed while reading.');
      let inflated;
      try { inflated = inflateSync(buffer.subarray(0,length),{maxOutputLength:raw.length,info:true}); }
      catch(e) { throw fail('corrupt','Invalid or oversized loose object.',e); }
      if(inflated.engine.bytesWritten !== length || !inflated.buffer.equals(raw) || hash(objectFormat,inflated.buffer) !== oid)throw fail('corrupt','Loose object content/hash mismatch.');
      await verifyStorage(); await verifyDirectory(fanout); check(); return true;
    } finally { await file.close(); }
  };
  // Cleanup deliberately ignores cancellation but never removes a foreign path or
  // final object. Retain uncertain temp files rather than guessing ownership.
  const cleanup = async () => {
    if(!temporary || !owned)return;
    for(const p of [directory,objects,fanout]) {
      const s = await lstat(p,{bigint:true});
      if(!s.isDirectory() || s.isSymbolicLink() || !same(s,directories.get(p)) || normalized(await realpath(p)) !== normalized(p))throw fail('unsafe','Cannot safely clean changed directory.');
    }
    let current;
    try { current = await lstat(temporary,{bigint:true}); } catch(e) { if(e.code === 'ENOENT'){temporary=undefined;return;} throw e; }
    if(!current.isFile() || current.isSymbolicLink() || !same(current,owned))throw fail('unsafe','Temporary path ownership changed; retained.');
    await unlink(temporary); temporary=undefined;
  };
  try {
    await authorize(); await verifyStorage();
    let hasFanout = true;
    try { await verifyDirectory(fanout); } catch(e) { if(e.code !== 'ENOENT')throw e; hasFanout=false; }
    if(hasFanout && await validateExisting()) { await authorize(); return {oid,created:false}; }
    const compressed = deflateSync(raw); check();
    await authorize(); await verifyStorage();
    if(hasFanout)await verifyDirectory(fanout);
    started=true;
    const notification=onStart();
    if(notification && typeof notification.then === 'function') {
      Promise.resolve(notification).catch(()=>{});
      throw fail('invalid','onStart must be synchronous.');
    }
    check();
    if(!hasFanout) {
      try { await mkdir(fanout); } catch(e) { if(e.code !== 'EEXIST')throw e; }
    }
    await verifyStorage(); await verifyDirectory(fanout); check();
    temporary=path.join(fanout,'.dsh-object-' + randomUUID());
    handle=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|(constants.O_NOFOLLOW||0),0o600);
    owned=await handle.stat({bigint:true});
    if(!plain(owned))throw fail('unsafe','Temporary object is not single-link.');
    await handle.writeFile(compressed); check(); await handle.sync();
    await handle.close(); handle=undefined;
    await authorize(); await verifyStorage(); await verifyDirectory(fanout);
    const temp=await lstat(temporary,{bigint:true});
    if(!plain(temp) || !same(temp,owned) || temp.size !== BigInt(compressed.length))throw fail('unsafe','Temporary object changed.');
    check(); let created=true;
    try { await link(temporary,target); }
    catch(e) { if(e.code !== 'EEXIST')throw e; created=false; }
    await cleanup(); // Drop our second link before validating the final nlink=1.
    if(!await validateExisting())throw fail('corrupt','Published object is missing.');
    await authorize(); return {oid,created};
  } catch(error) {
    try { if(handle){await handle.close();handle=undefined;} await cleanup(); }
    catch(cleanupError) { error = new AggregateError([error,cleanupError],'Object operation and owned-temp cleanup failed.'); }
    if(!started)throw error;
    throw Object.assign(fail('outcome-unknown','Append-only object storage started; object may exist. Never roll back with deletion or GC.',error),{outcomeUnknown:true,appendOnly:true});
  }
}
