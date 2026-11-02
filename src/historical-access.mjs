import {isObjectId} from '../git-history.mjs';

export const HISTORICAL_CACHE_LIMITS = Object.freeze({maxBytes: 32 * 1024 * 1024, maxEntries: 8, ttlMs: 60000});
const MAX_BLOB_BYTES = 16 * 1024 * 1024;
const MAX_LIST_BYTES = 16 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 100000;
const CHUNK_BYTES = 64 * 1024;

export function validateHistoricalPath(file, allowRoot = false) {
  if (typeof file !== 'string' || file.length > 32768 || (!file && !allowRoot) || file.includes('\0') || file.startsWith('/') || file.split('/').some(part => (!part || part === '.' || part === '..') && !(allowRoot && file === ''))) {
    throw Error('Invalid historical path');
  }
}

export function parseTreeEntries(buffer, prefix = '', maxEntries = MAX_DIRECTORY_ENTRIES) {
  if (!buffer.length) return [];
  const fields = buffer.toString('utf8').split('\0');
  if (fields.pop() !== '') throw Error('Truncated historical tree');
  if (fields.length > maxEntries) throw Error('Historical directory exceeds entry limit');
  const paths = new Set();
  return fields.map(record => {
    const tab = record.indexOf('\t');
    const match = /^(040000|100644|100755|120000|160000) (tree|blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})$/.exec(record.slice(0, tab));
    const file = record.slice(tab + 1);
    if (tab < 0 || !file || !match) throw Error('Invalid historical tree entry');
    validateHistoricalPath(file);
    const [,mode,type,oid] = match;
    if (type !== (mode === '040000' ? 'tree' : mode === '160000' ? 'commit' : 'blob')) throw Error('Invalid historical tree type');
    const fullPath = prefix + file;
    if (paths.has(fullPath)) throw Error('Duplicate historical tree entry');
    paths.add(fullPath);
    return {path: fullPath, mode, type, oid};
  });
}

/** Object cache only, never an authorization cache. Callers must revalidate the repository first. */
export function createHistoricalAccess({run, now = Date.now, maxBytes = HISTORICAL_CACHE_LIMITS.maxBytes, maxEntries = HISTORICAL_CACHE_LIMITS.maxEntries, ttlMs = HISTORICAL_CACHE_LIMITS.ttlMs} = {}) {
  if (typeof run !== 'function' || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > HISTORICAL_CACHE_LIMITS.maxBytes || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > HISTORICAL_CACHE_LIMITS.maxEntries || !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > HISTORICAL_CACHE_LIMITS.ttlMs) throw Error('Invalid historical cache configuration');
  const cache = new Map();
  let bytes = 0, reservedBytes = 0, reservedEntries = 0, epoch = 0, blobReads = 0, blobReadBytes = 0, decodeCount = 0, cacheHits = 0;
  const remove = key => {
    const entry = cache.get(key);
    if (!entry) return;
    clearTimeout(entry.timer);
    bytes -= entry.buffer.length;
    cache.delete(key);
  };
  const purge = () => {for (const [key,entry] of cache) if (entry.expiresAt <= now()) remove(key);};
  const clear = root => {
    epoch++; // In-flight reads predating revocation must never repopulate the cache.
    for (const [key,entry] of cache) if (root === undefined || root === entry.root) remove(key);
  };
  const ensureCommit = async (root, commit, signal) => {
    signal?.throwIfAborted();
    if (!isObjectId(commit)) throw Error('Invalid commit id');
    const type = (await run(root, ['cat-file','-t',commit], 2097152, {signal})).toString('utf8').trim();
    if (type !== 'commit') throw Error('Commit object required');
  };
  const lookup = async (root, {commit,path:file,signal,missingMessage = 'Path is not part of selected commit'}) => {
    validateHistoricalPath(file);
    await ensureCommit(root, commit, signal);
    const listing = await run(root, ['ls-tree','-z','--full-tree',commit,'--',file], 2097152, {signal});
    const entries = parseTreeEntries(listing);
    const entry = entries.find(row => row.path === file);
    if (!entry) throw Error(missingMessage);
    signal?.throwIfAborted();
    return entry;
  };
  const treePage = async (root, {commit,path:directory = '',offset = 0,limit = 100,query = '',signal} = {}) => {
    validateHistoricalPath(directory, true);
    if (typeof query !== 'string' || query.length > 1024 || /[\0\r\n]/.test(query)) throw Error('Invalid historical tree query');
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_DIRECTORY_ENTRIES || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('Invalid tree pagination');
    let tree = commit;
    if (directory) {
      const entry = await lookup(root, {commit,path:directory,signal});
      if (entry.type !== 'tree' || entry.mode !== '040000') throw Error('Historical directory required');
      tree = entry.oid;
    } else await ensureCommit(root, commit, signal);
    // The revision is an already-validated OID, never user-controlled rev:path syntax.
    const buffer = await run(root, ['ls-tree','-z',tree], MAX_LIST_BYTES, {signal});
    const entries = parseTreeEntries(buffer, directory ? directory + '/' : '');
    if (entries.some(entry => entry.path.slice(directory ? directory.length + 1 : 0).includes('/'))) throw Error('Expected direct historical directory entries');
    signal?.throwIfAborted();
    const needle = query.toLowerCase();
    const prefixLength = directory ? directory.length + 1 : 0;
    const filtered = needle ? entries.filter(entry => entry.path.slice(prefixLength).toLowerCase().includes(needle)) : entries;
    filtered.sort((a,b) => Number(b.type === 'tree') - Number(a.type === 'tree') || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return {commit,path:directory,query,entries:filtered.slice(offset,offset + limit),nextOffset:offset + limit < filtered.length ? offset + limit : null};
  };
  const segment = async (root, {commit,path:file,offset = 0,signal,expectedEpoch = epoch} = {}) => {
    const generation = expectedEpoch; // Includes caller repository validation and all member lookups.
    if (!Number.isInteger(offset) || offset < 0 || offset > MAX_BLOB_BYTES) throw Error('Invalid segment offset');
    const entry = await lookup(root, {commit,path:file,signal,missingMessage:'Segment requires a selected committed regular file'});
    if (entry.type !== 'blob' || !['100644','100755'].includes(entry.mode)) throw Error('Segment requires a selected committed regular file');
    purge();
    const key = JSON.stringify([root,commit,entry.oid]);
    let buffer = generation === epoch ? cache.get(key)?.buffer : undefined;
    if (buffer) cacheHits++;
    if (!buffer) {
      const rawSize = (await run(root, ['cat-file','-s',entry.oid], 2097152, {signal})).toString('utf8').trim();
      if (!/^\d+$/.test(rawSize)) throw Error('Invalid object size');
      const size = Number(rawSize);
      if (!Number.isSafeInteger(size) || size > MAX_BLOB_BYTES) throw Error('Segmented file exceeds 16 MiB limit');
      if (offset > size) throw Error('Segment offset exceeds file size');
      if (size > maxBytes) throw Error('Segmented file exceeds cache byte budget');
      purge();
      while (cache.size && (bytes + reservedBytes + size > maxBytes || cache.size + reservedEntries >= maxEntries)) remove(cache.keys().next().value);
      if (bytes + reservedBytes + size > maxBytes || cache.size + reservedEntries >= maxEntries) throw Object.assign(Error('Historical cache is busy; retry the read'), {code:'vcs/busy'});
      reservedBytes += size; reservedEntries++;
      try {
        blobReads++;
        buffer = await run(root, ['cat-file','blob',entry.oid], Math.max(1,size), {signal});
        blobReadBytes += buffer.length;
        signal?.throwIfAborted();
        if (buffer.length !== size) throw Error('Historical blob size mismatch');
        if (buffer.includes(0) || buffer.some(byte => byte < 32 && ![9,10,12,13].includes(byte))) throw Error('Segments support UTF-8 text only');
        new TextDecoder('utf-8',{fatal:true}).decode(buffer);
        decodeCount++;
        if (generation === epoch) {
          remove(key);
          const timer = setTimeout(() => remove(key), ttlMs);
          timer.unref?.();
          cache.set(key, {root,buffer,expiresAt:now() + ttlMs,timer});
          bytes += buffer.length;
        }
      } finally {reservedBytes -= size; reservedEntries--;}
    }
    signal?.throwIfAborted();
    const size = buffer.length;
    if (offset > size) throw Error('Segment offset exceeds file size');
    if (offset < size && (buffer[offset] & 192) === 128) throw Error('Segment offset splits UTF-8 character');
    let end = Math.min(size, offset + CHUNK_BYTES);
    while (end < size && (buffer[end] & 192) === 128) end--;
    const text = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(buffer.subarray(offset,end));
    signal?.throwIfAborted();
    return {commit,path:file,oid:entry.oid,encoding:'UTF-8',offset,endOffset:end,totalBytes:size,nextOffset:end < size ? end : null,text};
  };
  return {lookup,treePage,segment,clear,captureEpoch:() => epoch,stats:() => {purge();return {bytes,entries:cache.size,reservedBytes,reservedEntries,blobReads,blobReadBytes,decodeCount,cacheHits};}};
}
