import { readFile } from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {registerFrontendAssets} from './frontend-assets.mjs';
const runningFrontend=JSON.parse(readFileSync(new URL('./dist/frontend.json',import.meta.url),'utf8'));
import * as adapter from './vcs.mjs';
import {runtimeInfo,checkUpdate} from './dist/updates.mjs';
import {createSvnHttpsHost} from './dist/svn-host.mjs';
import {historySearchArgs,validateDateBound,isObjectId,isChangeId} from './git-history.mjs';

export const name = 'dsh-vcs';
export const inject = ['connection', 'webServer', 'sessions', 'sessionPersistence'];
export const RPC_CHANNEL = '/vcs-rpc';
const ASSETS = ['editor.js', 'editor.css', 'editor.worker.js'];
const failure = (code, message) => ({ ok: false, error: { code, message, details: {} } });
const invalid = (message) => Object.assign(new Error(message), { code: 'vcs/invalid-request' });

/** Authoritative Session lookup: never accept a browser-provided directory. */
export async function resolveSessionCwd(ctx, sessionId, signal) {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 256 || /[\/\\\0]/.test(sessionId)) {
    throw invalid('A valid sessionId is required.');
  }
  signal?.throwIfAborted();
  const live = ctx.sessions.get(sessionId);
  const header = live?.header ?? (await ctx.sessionPersistence.stat(sessionId, { signal }))?.header;
  if (!header?.cwd) throw Object.assign(new Error('The Session has no available working directory.'), { code: 'vcs/session-unavailable' });
  return header.cwd;
}

const rediscover = () => Object.assign(new Error('Repository authorization is missing, expired, or changed. Rediscover repositories for this Session and retry.'), { code: 'vcs/rediscover-required' });

// Exact request fields are a protocol contract, independent of dispatch.
const REQUEST_FIELDS = {
  'vcs/repositories': ['sessionId', 'subdirectory'],
  'vcs/svn-identity': ['sessionId', 'repositoryId'],
  'vcs/references': ['sessionId', 'repositoryId'],
  'vcs/stash-list': ['sessionId', 'repositoryId'],
  'vcs/grep': ['sessionId', 'repositoryId', 'commit', 'query'],
  'vcs/status': ['sessionId', 'repositoryId', 'mode'],
  'vcs/compare': ['sessionId', 'repositoryId', 'mode', 'id', 'large'],
  'vcs/conflict-stages': ['sessionId', 'repositoryId', 'mode', 'id'],
  'vcs/history': ['sessionId', 'repositoryId', 'snapshot', 'offset', 'limit', 'search'],
  'vcs/commit': ['sessionId', 'repositoryId', 'commit', 'parentIndex'],
  'vcs/commit-compare': ['sessionId', 'repositoryId', 'commit', 'parentIndex', 'id', 'large'],
  'vcs/file-history': ['sessionId', 'repositoryId', 'commit', 'parentIndex', 'id', 'offset', 'limit', 'follow', 'since', 'until'],
  'vcs/blame': ['sessionId', 'repositoryId', 'commit', 'parentIndex', 'id', 'startLine', 'lineLimit'],
  'vcs/revision-changes': ['sessionId', 'repositoryId', 'base', 'target'],
  'vcs/revision-compare': ['sessionId', 'repositoryId', 'base', 'target', 'id', 'large'],
  'vcs/revision-image': ['sessionId', 'repositoryId', 'base', 'target', 'id', 'side'],
  'vcs/tree': ['sessionId', 'repositoryId', 'commit'],
  'vcs/tree-file': ['sessionId', 'repositoryId', 'commit', 'path'],
  'vcs/tree-segment': ['sessionId', 'repositoryId', 'commit', 'path', 'offset'],
  'vcs/tree-history': ['sessionId', 'repositoryId', 'commit', 'path', 'offset', 'limit', 'follow', 'since', 'until'],
  'vcs/commit-image': ['sessionId', 'repositoryId', 'commit', 'parentIndex', 'id', 'side'],
  'vcs/workspace-image': ['sessionId', 'repositoryId', 'mode', 'id', 'side'],
};

/** The supported endpoint list and each field whitelist derive from REQUEST_FIELDS. */
const ACTION_ENDPOINTS = new Set(Object.keys(REQUEST_FIELDS));
const REQUEST_FIELD_SETS = new Map(Object.entries(REQUEST_FIELDS).map(([endpoint, fields]) => [endpoint, new Set(fields)]));
const UPDATE_ENDPOINTS = new Set(['vcs/runtime-info', 'vcs/check-update']);

// Only repositories, SVN identity, workspace status and workspace comparison can
// address SVN working copies; every other action reads immutable Git history.
const SVN_CAPABLE_ENDPOINTS = new Set(['vcs/repositories', 'vcs/svn-identity', 'vcs/status', 'vcs/compare']);
const GIT_ONLY_ENDPOINTS = new Set([...ACTION_ENDPOINTS].filter(endpoint => !SVN_CAPABLE_ENDPOINTS.has(endpoint)));

// Named endpoint groups keep every request-shape and capacity decision in one place.
const HISTORICAL_PATH_ENDPOINTS = new Set(['vcs/tree-file', 'vcs/tree-segment', 'vcs/tree-history']);
const REVISION_PAIR_ENDPOINTS = new Set(['vcs/revision-changes', 'vcs/revision-compare', 'vcs/revision-image']);
const REVISION_CHANGE_ID_ENDPOINTS = new Set(['vcs/revision-compare', 'vcs/revision-image']);
const SELECTED_CHANGE_ENDPOINTS = new Set(['vcs/commit-compare', 'vcs/file-history', 'vcs/blame', 'vcs/commit-image']);
const COMMIT_ENDPOINTS = new Set(['vcs/commit', 'vcs/commit-compare', 'vcs/file-history', 'vcs/blame', 'vcs/tree', 'vcs/tree-file', 'vcs/tree-segment', 'vcs/tree-history', 'vcs/commit-image']);
const LARGE_COMPARISON_ENDPOINTS = new Set(['vcs/compare', 'vcs/commit-compare', 'vcs/revision-compare']);
const HISTORY_PATH_ENDPOINTS = new Set(['vcs/file-history', 'vcs/tree-history']);
const PAGINATED_HISTORY_ENDPOINTS = new Set(['vcs/history', 'vcs/file-history', 'vcs/tree-history']);
const IMAGE_ENDPOINTS = new Set(['vcs/commit-image', 'vcs/revision-image', 'vcs/workspace-image']);
const WORKSPACE_CHANGE_ENDPOINTS = new Set(['vcs/workspace-image', 'vcs/conflict-stages']);
const CHANGE_ID_COMPARISON_ENDPOINTS = new Set(['vcs/compare', 'vcs/workspace-image']);
const IMAGE_SIDES = new Set(['left', 'right']);
const COMPARISON_MODES = new Set(['all', 'unstaged', 'staged']);

/** Repositories requests may only narrow discovery to a relative Session subdirectory. */
function validateRepositoriesPayload(payload) {
  if (payload.subdirectory === undefined) return;
  const dir = payload.subdirectory;
  if (typeof dir !== 'string' || !dir || dir.length > 4096 || /[\0:]/.test(dir) || /^[\/\\]/.test(dir) || dir.split(/[\/\\]/).includes('..')) throw invalid('subdirectory must be a relative path within the Session directory.');
}

/** Historical paths are repository-relative and can never be absolute or escape. */
function validateHistoricalPath(endpoint, path) {
  if (!HISTORICAL_PATH_ENDPOINTS.has(endpoint)) return;
  if (typeof path !== 'string' || !path || path.length > 32768 || path.includes('\0') || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) throw invalid('Invalid historical file path.');
}

function validateImageSide(endpoint, side) {
  if (IMAGE_ENDPOINTS.has(endpoint) && side !== undefined && !IMAGE_SIDES.has(side)) throw invalid('Invalid image side.');
}

function validateRevisionSelection(endpoint, payload) {
  if (!REVISION_PAIR_ENDPOINTS.has(endpoint)) return;
  for (const oid of [payload.base, payload.target]) if (typeof oid !== 'string' || !isObjectId(oid)) throw invalid('Invalid revision commit id.');
  if (REVISION_CHANGE_ID_ENDPOINTS.has(endpoint) && (typeof payload.id !== 'string' || !isChangeId(payload.id))) throw invalid('Invalid revision change id.');
}

function validateSelectedChangeId(endpoint, payload) {
  if (SELECTED_CHANGE_ENDPOINTS.has(endpoint) && (typeof payload.id !== 'string' || !isChangeId(payload.id))) throw invalid('Invalid historical change id.');
}

function validateCommitSelection(endpoint, payload) {
  if (!COMMIT_ENDPOINTS.has(endpoint)) return;
  if (typeof payload.commit !== 'string' || !isObjectId(payload.commit)) throw invalid('Invalid commit id.');
  if (payload.parentIndex !== undefined && (!Number.isInteger(payload.parentIndex) || payload.parentIndex < 0 || payload.parentIndex > 100)) throw invalid('Invalid parent index.');
}

function validateLargeComparison(endpoint, payload) {
  if (LARGE_COMPARISON_ENDPOINTS.has(endpoint) && payload.large !== undefined && typeof payload.large !== 'boolean') throw invalid('Invalid large comparison mode.');
}

function validateBlameWindow(endpoint, payload) {
  if (endpoint !== 'vcs/blame') return;
  const startInvalid = payload.startLine !== undefined && (!Number.isInteger(payload.startLine) || payload.startLine < 1 || payload.startLine > 100001);
  const limitInvalid = payload.lineLimit !== undefined && (!Number.isInteger(payload.lineLimit) || payload.lineLimit < 1 || payload.lineLimit > 500);
  if (startInvalid || limitInvalid) throw invalid('Invalid blame line window.');
}

function validateContentSearch(endpoint, payload) {
  if (endpoint !== 'vcs/grep') return;
  if (typeof payload.query !== 'string' || !payload.query || payload.query.length > 1024 || /[\0\r\n]/.test(payload.query)) throw invalid('Invalid content search query.');
  if (payload.commit !== undefined && (typeof payload.commit !== 'string' || !isObjectId(payload.commit))) throw invalid('Invalid content search commit.');
}

function validateRenameFollow(endpoint, payload) {
  if (HISTORY_PATH_ENDPOINTS.has(endpoint) && payload.follow !== undefined && typeof payload.follow !== 'boolean') throw invalid('Invalid rename follow mode.');
}

function validateHistoryDates(endpoint, payload) {
  if (!HISTORY_PATH_ENDPOINTS.has(endpoint) || (payload.since === undefined && payload.until === undefined)) return;
  try {
    if (payload.since !== undefined) validateDateBound(payload.since);
    if (payload.until !== undefined) validateDateBound(payload.until);
  } catch { throw invalid('Invalid history date bound.'); }
}

function validateHistoryPagination(endpoint, payload) {
  if (!PAGINATED_HISTORY_ENDPOINTS.has(endpoint)) return;
  if (payload.offset === null || payload.limit === null) throw invalid('Invalid history pagination.');
  if (payload.snapshot !== undefined && (typeof payload.snapshot !== 'string' || !isObjectId(payload.snapshot))) throw invalid('Invalid history snapshot.');
  const offset = payload.offset ?? 0, limit = payload.limit ?? 50;
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('Invalid history pagination.');
}

function validateWorkspaceChangeId(endpoint, payload) {
  if (WORKSPACE_CHANGE_ENDPOINTS.has(endpoint) && (typeof payload.id !== 'string' || !isChangeId(payload.id))) throw invalid('Invalid workspace image change id.');
}

function validateModeAndComparisonId(endpoint, payload) {
  if (!COMPARISON_MODES.has(payload.mode ?? 'all')) throw invalid('Unsupported comparison mode.');
  if (CHANGE_ID_COMPARISON_ENDPOINTS.has(endpoint) && (typeof payload.id !== 'string' || !payload.id || payload.id.length > 32768)) throw invalid('A change id is required.');
}

/** The validation order below is part of the protocol: the first failing group wins. */
function validateRepositoryPayload(endpoint, payload) {
  if (typeof payload.repositoryId !== 'string' || !payload.repositoryId || payload.repositoryId.length > 1024) throw invalid('A discovered repositoryId is required.');
  validateHistoricalPath(endpoint, payload.path);
  validateImageSide(endpoint, payload.side);
  validateRevisionSelection(endpoint, payload);
  validateSelectedChangeId(endpoint, payload);
  validateCommitSelection(endpoint, payload);
  validateLargeComparison(endpoint, payload);
  if (endpoint === 'vcs/tree-segment' && payload.offset !== undefined && (!Number.isInteger(payload.offset) || payload.offset < 0 || payload.offset > 16777216)) throw invalid('Invalid segment offset.');
  validateBlameWindow(endpoint, payload);
  validateContentSearch(endpoint, payload);
  validateRenameFollow(endpoint, payload);
  validateHistoryDates(endpoint, payload);
  if (endpoint === 'vcs/history') { try { historySearchArgs(payload.search); } catch { throw invalid('Invalid history search.'); } }
  validateHistoryPagination(endpoint, payload);
  validateWorkspaceChangeId(endpoint, payload);
  validateModeAndComparisonId(endpoint, payload);
}

function validatePayload(endpoint, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('An object payload is required.');
  const allowedFields = REQUEST_FIELD_SETS.get(endpoint);
  if (Object.keys(payload).some(key => !allowedFields.has(key))) throw invalid('Only Session-addressed repository requests are supported; unknown payload field.');
  if (endpoint === 'vcs/repositories') validateRepositoriesPayload(payload);
  else validateRepositoryPayload(endpoint, payload);
}

/** Forward an optional field only when the request actually supplied it. */
const optionalField = (key, value) => value === undefined ? {} : {[key]: value};

/** Dispatch only after grants and capacity have been checked by createHandler. */
async function readRepository(api, endpoint, repository, payload, {cwd, mode, signal}) {
  switch (endpoint) {
    case 'vcs/tree-history':
      return api.listPathHistory({...repository}, {
        commit: payload.commit, path: payload.path, offset: payload.offset ?? 0, limit: payload.limit ?? 50, follow: payload.follow ?? false,
        ...optionalField('since', payload.since), ...optionalField('until', payload.until), signal,
      });
    case 'vcs/tree-segment':
      return api.getHistoricalSegment({...repository}, {commit: payload.commit, path: payload.path, offset: payload.offset ?? 0, signal});
    case 'vcs/workspace-image':
      return api.getWorkspaceImage({...repository}, {mode, id: payload.id, side: payload.side ?? 'right', signal});
    case 'vcs/revision-image':
      return api.getRevisionImage({...repository}, {base: payload.base, target: payload.target, id: payload.id, side: payload.side ?? 'right', signal});
    case 'vcs/references':
      return api.listReferences({...repository}, {signal});
    case 'vcs/stash-list':
      return api.listStashes({...repository}, {signal});
    case 'vcs/grep':
      return api.searchRepositoryContent({...repository}, {commit: payload.commit, query: payload.query, signal});
    case 'vcs/commit-image':
      return api.getCommitImage({...repository}, {commit: payload.commit, parentIndex: payload.parentIndex ?? 0, id: payload.id, side: payload.side ?? 'right', signal});
    case 'vcs/tree-file':
      return api.getHistoricalFile({...repository}, {commit: payload.commit, path: payload.path, signal});
    case 'vcs/tree':
      return api.getHistoricalTree({...repository}, {commit: payload.commit, signal});
    case 'vcs/blame':
      return api.getFileBlame({...repository}, {
        commit: payload.commit, parentIndex: payload.parentIndex ?? 0, id: payload.id,
        ...optionalField('startLine', payload.startLine), ...optionalField('lineLimit', payload.lineLimit), signal,
      });
    case 'vcs/file-history':
      return api.listFileHistory({...repository}, {
        commit: payload.commit, parentIndex: payload.parentIndex ?? 0, id: payload.id, offset: payload.offset ?? 0, limit: payload.limit ?? 50,
        ...optionalField('follow', payload.follow), ...optionalField('since', payload.since), ...optionalField('until', payload.until), signal,
      });
    case 'vcs/revision-changes':
      return api.getRevisionChanges({...repository}, {base: payload.base, target: payload.target, signal});
    case 'vcs/revision-compare':
      return api.getRevisionComparison({...repository}, {base: payload.base, target: payload.target, id: payload.id, ...optionalField('large', payload.large), signal});
    case 'vcs/commit-compare':
      return api.getCommitComparison({...repository}, {commit: payload.commit, parentIndex: payload.parentIndex ?? 0, id: payload.id, ...optionalField('large', payload.large), signal});
    case 'vcs/commit':
      return api.getCommitDetails({...repository}, {commit: payload.commit, parentIndex: payload.parentIndex ?? 0, signal});
    case 'vcs/history':
      return api.listHistory({...repository}, {snapshot: payload.snapshot, search: payload.search, offset: payload.offset ?? 0, limit: payload.limit ?? 50, signal});
    case 'vcs/status':
      return {cwd, repository: {...repository}, changes: await api.listChanges({...repository}, mode, {signal}), mode};
    case 'vcs/conflict-stages':
      return api.getConflictStages({...repository}, {mode, id: payload.id, signal});
    case 'vcs/compare':
      return api.getComparison({...repository}, {mode, id: payload.id, ...optionalField('signal', signal), ...optionalField('large', payload.large)});
  }
}

/** Limit active adapter operations and retain only bounded, short-lived discovery grants. */
export function createHandler(ctx, api = adapter, maxActive = 4, { now = Date.now, ttlMs = 5 * 60_000, maxSessions = 32, maxRepositories = 512, bindSvnIdentityResolver } = {}) {
  let active = 0, activeImages = 0, activeSegments = 0;
  const sessions = new Map();

  /** Resolve a live Session grant, evicting expired entries and cwd-mismatched grants. */
  function current(sessionId, cwd) {
    for (const [id, entry] of sessions) if (entry.expiresAt <= now()) sessions.delete(id);
    const entry = sessions.get(sessionId);
    if (entry && entry.cwd !== cwd) { sessions.delete(sessionId); return undefined; }
    return entry;
  }

  /** Re-read the Session cwd, then require the same grant object to still be current. */
  async function assertCurrent(sessionId, cwd, entry, signal) {
    const latest = await resolveSessionCwd(ctx, sessionId, signal);
    signal?.throwIfAborted();
    if (current(sessionId, latest) !== entry || latest !== cwd) throw rediscover();
  }

  /** Adapter work finished: both the cwd grant and the selected repository must still be current. */
  async function assertCurrentGrant(sessionId, cwd, entry, repositoryId, repository, signal) {
    await assertCurrent(sessionId, cwd, entry, signal);
    if (entry.repositories.get(repositoryId) !== repository) throw rediscover();
  }

  if (bindSvnIdentityResolver !== undefined) {
    if (typeof bindSvnIdentityResolver !== 'function') throw new Error('Invalid internal SVN resolver binding');
    bindSvnIdentityResolver(async (address, signal) => {
      validatePayload('vcs/svn-identity', address);
      signal?.throwIfAborted();
      const cwd = await resolveSessionCwd(ctx, address.sessionId, signal);
      const entry = current(address.sessionId, cwd);
      const repository = entry?.repositories.get(address.repositoryId);
      if (!repository) throw rediscover();
      if (repository.type !== 'svn') throw invalid('SVN working copy required.');
      const identity = await api.getSvnIdentity({...repository}, {signal});
      await assertCurrentGrant(address.sessionId, cwd, entry, address.repositoryId, repository, signal);
      return {...identity, cwd};
    });
  }

  /** Update queries accept no fields and are admitted separately from repository reads. */
  async function handleUpdateRequest(endpoint, payload, signal) {
    try {
      signal?.throwIfAborted();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length) throw invalid('Update requests accept no fields.');
      if (endpoint === 'vcs/runtime-info') return {ok: true, value: runtimeInfo()};
      if (active >= maxActive) return failure('vcs/busy', 'Too many VCS requests. Please retry.');
      active++;
      try { return {ok: true, value: await checkUpdate({signal})}; } finally { active--; }
    } catch (error) {
      return failure(signal?.aborted ? 'vcs/cancelled' : 'vcs/update-failed', error.message);
    }
  }

  /** Discovery creates, replaces or merges grants; a stale scan can never resurrect one. */
  async function discoverRepositories(payload, cwd, entry, signal) {
    if (!entry) {
      while (sessions.size >= maxSessions) sessions.delete(sessions.keys().next().value);
      entry = { cwd, repositories: new Map(), expiresAt: now() + ttlMs, scanSequence: 0, fullScanSequence: 0 };
      sessions.set(payload.sessionId, entry);
    }
    const targeted = payload.subdirectory !== undefined;
    const sequence = ++entry.scanSequence;
    if (!targeted) entry.fullScanSequence = sequence;
    const fullSequence = entry.fullScanSequence;
    const result = await api.discoverRepositories(cwd, { signal, subdirectory: payload.subdirectory, maxDepth: 1, shallow: true });
    // A stale scan must never recreate/replace a grant invalidated by a cwd change or eviction.
    await assertCurrent(payload.sessionId, cwd, entry, signal);
    // Full scans replace grants. Never let an older full scan erase a newer scan,
    // or an older targeted scan resurrect grants after a new full scan begins.
    if ((!targeted && sequence !== entry.scanSequence) || (targeted && fullSequence !== entry.fullScanSequence)) throw rediscover();
    const grants = targeted ? new Map(entry.repositories) : new Map();
    let truncated = !!result.truncated;
    const warnings = [...result.warnings];
    const repositories = [];
    for (const repository of result.repositories) {
      if (!grants.has(repository.id) && grants.size >= maxRepositories) { truncated = true; continue; }
      grants.set(repository.id, { ...repository });
      repositories.push({ ...repository });
    }
    if (repositories.length !== result.repositories.length) warnings.push('Repository authorization limit reached; use a new Session or narrow its working directory.');
    entry.repositories = grants;
    entry.expiresAt = now() + ttlMs;
    return { cwd, repositories, truncated, warnings };
  }

  /** Read and revalidate SVN identity, returning only the fixed remote projection. */
  async function readSvnIdentity(payload, cwd, entry, repository, signal) {
    if (repository.type !== 'svn') throw invalid('SVN working copy required.');
    const identity = await api.getSvnIdentity({...repository}, {signal});
    await assertCurrentGrant(payload.sessionId, cwd, entry, payload.repositoryId, repository, signal);
    return {
      root: identity.root, uuid: identity.uuid, scope: identity.scope,
      origin: identity.origin, revision: identity.revision, remoteEnabled: false,
    };
  }

  /** Reserve the independent image or text-segment slot; report a busy failure instead of queuing. */
  function admitHeavyOperation(endpoint, payload) {
    let imageSlot = false, segmentSlot = false;
    if (endpoint === 'vcs/tree-segment' || (LARGE_COMPARISON_ENDPOINTS.has(endpoint) && payload.large === true)) {
      if (activeSegments >= 1) return {busy: failure('vcs/busy', 'A text segment is already loading. Please retry.'), imageSlot, segmentSlot};
      activeSegments++; segmentSlot = true;
    }
    if (IMAGE_ENDPOINTS.has(endpoint)) {
      if (activeImages >= 2) return {busy: failure('vcs/busy', 'Too many image requests. Please retry.'), imageSlot, segmentSlot};
      activeImages++; imageSlot = true;
    }
    return {busy: null, imageSlot, segmentSlot};
  }

  /** Read through the adapter, then require both the cwd grant and the selected repository to be current. */
  async function readGrantedRepository(endpoint, repository, payload, cwd, mode, entry, signal) {
    const value = await readRepository(api, endpoint, repository, payload, {cwd, mode, signal});
    await assertCurrentGrant(payload.sessionId, cwd, entry, payload.repositoryId, repository, signal);
    return value;
  }

  return async (endpoint, payload, signal) => {
    if (UPDATE_ENDPOINTS.has(endpoint)) return handleUpdateRequest(endpoint, payload, signal);
    if (!ACTION_ENDPOINTS.has(endpoint)) return failure('vcs/not-found', 'Unknown VCS endpoint.');
    if (active >= maxActive) return failure('vcs/busy', 'Too many VCS requests. Please retry.');
    active++;
    let imageSlot = false, segmentSlot = false;
    try {
      signal?.throwIfAborted();
      validatePayload(endpoint, payload);
      const cwd = await resolveSessionCwd(ctx, payload.sessionId, signal);
      signal?.throwIfAborted();
      const entry = current(payload.sessionId, cwd);
      if (endpoint === 'vcs/repositories') return { ok: true, value: await discoverRepositories(payload, cwd, entry, signal) };
      const repository = entry?.repositories.get(payload.repositoryId);
      if (!repository) throw rediscover();
      if (endpoint === 'vcs/svn-identity') return { ok: true, value: await readSvnIdentity(payload, cwd, entry, repository, signal) };
      const mode = payload.mode ?? 'all';
      if (repository.type === 'svn' && mode !== 'all') throw invalid('SVN supports only all mode.');
      // Both adapter operations revalidate the canonical root; comparison also validates
      // the change ID against fresh status, so do not duplicate a full status scan here.
      if (GIT_ONLY_ENDPOINTS.has(endpoint) && repository.type !== 'git') throw invalid('History currently supports Git only.');
      const admission = admitHeavyOperation(endpoint, payload);
      imageSlot = admission.imageSlot;
      segmentSlot = admission.segmentSlot;
      if (admission.busy) return admission.busy;
      return { ok: true, value: await readGrantedRepository(endpoint, repository, payload, cwd, mode, entry, signal) };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') return failure('vcs/cancelled', 'The request was cancelled.');
      const code = typeof error?.code === 'string' && error.code.startsWith('vcs/') ? error.code : 'vcs/operation-failed';
      return failure(code, error instanceof Error ? error.message : String(error));
    } finally {
      active--;
      if (imageSlot) activeImages--;
      if (segmentSlot) activeSegments--;
    }
  };
}

/** Content type is fixed per build artifact; URL input never chooses it. */
const assetContentType = filename => filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
/** Shared bounded-response headers for both asset transports. */
const assetHeaders = (filename, bytes) => ({
  'Content-Type': assetContentType(filename),
  'Content-Length': String(bytes.byteLength),
  'Cache-Control': 'private, no-cache',
  'X-Content-Type-Options': 'nosniff',
});

/** Three fixed authenticated assets; URL input never enters a filesystem path. */
export function registerAssets(ctx, load = filename => readFile(new URL('./dist/' + filename, import.meta.url))) {
  for (const filename of ASSETS) {
    ctx.connection.fetch.register({
      path: '/api/vcs-assets/' + filename,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      async fetch(request) {
        try {
          const bytes = await load(filename);
          return new Response(request.method === 'HEAD' ? null : bytes, { headers: assetHeaders(filename, bytes) });
        } catch { return new Response('VCS editor assets unavailable. Build the plugin first.', { status: 503 }); }
      },
    });
  }
}

/** Dedicated static routes avoid dependence on the shared /api dispatcher. */
export function registerDirectAssets(ctx, load = filename => readFile(new URL('./dist/' + filename, import.meta.url))) {
  for (const filename of ASSETS) ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: '/vcs-assets/' + filename,
    async handler(req, res) {
      const admission = ctx.connection.admit(req);
      if ('rejection' in admission) { res.writeHead(admission.rejection); res.end(admission.rejection === 401 ? 'unauthorized' : 'forbidden'); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, {Allow:'GET, HEAD'}); res.end(); return; }
      try {
        const bytes = await load(filename);
        res.writeHead(200, assetHeaders(filename, bytes));
        res.end(req.method === 'HEAD' ? undefined : bytes);
      } catch { res.writeHead(503, {'Content-Type':'text/plain; charset=utf-8'}); res.end('VCS editor assets unavailable.'); }
    }
  }));
}

export function apply(ctx) {
  // Pass the plugin owner explicitly: the nested rpc getter can retain the
  // connection service context, which does not inject webServer.
  const host=createSvnHttpsHost(ctx,adapter);
  ctx.effect(()=>()=>host.dispose());
  ctx.connection.register(ctx, RPC_CHANNEL, host.handle);
  registerAssets(ctx);
  registerDirectAssets(ctx);
  registerFrontendAssets(ctx,{running:runningFrontend});
}
