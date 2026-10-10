import { readFile } from 'node:fs/promises';
import * as adapter from './vcs.mjs';
import {createSvnHttpsHost} from './dist/svn-host.mjs';

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

import {historySearchArgs} from './git-history.mjs';

// Exact request fields are a protocol contract, independent of dispatch.
const REQUEST_FIELDS = {
  'vcs/repositories': ['sessionId', 'subdirectory'],
  'vcs/svn-identity': ['sessionId', 'repositoryId'],
  'vcs/references': ['sessionId', 'repositoryId'],
  'vcs/status': ['sessionId', 'repositoryId', 'mode'],
  'vcs/compare': ['sessionId', 'repositoryId', 'mode', 'id', 'large'],
  'vcs/conflict-stages': ['sessionId', 'repositoryId', 'mode', 'id'],
  'vcs/history': ['sessionId', 'repositoryId', 'snapshot', 'offset', 'limit', 'search'],
  'vcs/commit': ['sessionId', 'repositoryId', 'commit', 'parentIndex'],
  'vcs/commit-compare': ['sessionId', 'repositoryId', 'commit', 'parentIndex', 'id', 'large'],
  'vcs/file-history': ['sessionId', 'repositoryId', 'commit', 'parentIndex', 'id', 'offset', 'limit', 'follow'],
  'vcs/blame': ['sessionId', 'repositoryId', 'commit', 'parentIndex', 'id', 'startLine', 'lineLimit'],
  'vcs/revision-changes': ['sessionId', 'repositoryId', 'base', 'target'],
  'vcs/revision-compare': ['sessionId', 'repositoryId', 'base', 'target', 'id', 'large'],
  'vcs/revision-image': ['sessionId', 'repositoryId', 'base', 'target', 'id', 'side'],
  'vcs/tree': ['sessionId', 'repositoryId', 'commit'],
  'vcs/tree-file': ['sessionId', 'repositoryId', 'commit', 'path'],
  'vcs/tree-segment': ['sessionId', 'repositoryId', 'commit', 'path', 'offset'],
  'vcs/commit-image': ['sessionId', 'repositoryId', 'commit', 'parentIndex', 'id', 'side'],
  'vcs/workspace-image': ['sessionId', 'repositoryId', 'mode', 'id', 'side'],
};
function validatePayload(endpoint, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('An object payload is required.');
  const fields = REQUEST_FIELDS[endpoint];
  if (Object.keys(payload).some(key => !fields.includes(key))) throw invalid('Only Session-addressed repository requests are supported; unknown payload field.');
  if (endpoint === 'vcs/repositories') {
    if (payload.subdirectory !== undefined) {
      const dir = payload.subdirectory;
      if (typeof dir !== 'string' || !dir || dir.length > 4096 || /[\0:]/.test(dir) || /^[\/\\]/.test(dir) || dir.split(/[\/\\]/).includes('..')) throw invalid('subdirectory must be a relative path within the Session directory.');
    }
  } else {
    if (typeof payload.repositoryId !== 'string' || !payload.repositoryId || payload.repositoryId.length > 1024) throw invalid('A discovered repositoryId is required.');
    if(['vcs/tree-file','vcs/tree-segment'].includes(endpoint)&&(typeof payload.path!=='string'||!payload.path||payload.path.length>32768||payload.path.includes('\0')||payload.path.startsWith('/')||payload.path.split('/').some(part=>!part||part==='.'||part==='..')))throw invalid('Invalid historical file path.');
    if(['vcs/commit-image','vcs/revision-image','vcs/workspace-image'].includes(endpoint)&&payload.side!==undefined&&!['left','right'].includes(payload.side))throw invalid('Invalid image side.');
    if(['vcs/revision-changes','vcs/revision-compare','vcs/revision-image'].includes(endpoint)){
      for(const oid of [payload.base,payload.target])if(typeof oid!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid))throw invalid('Invalid revision commit id.');
      if(['vcs/revision-compare','vcs/revision-image'].includes(endpoint)&&(typeof payload.id!=='string'||!/^[a-f0-9]{64}$/.test(payload.id)))throw invalid('Invalid revision change id.');
    }
    if(['vcs/commit-compare','vcs/file-history','vcs/blame','vcs/commit-image'].includes(endpoint)&&(typeof payload.id!=='string'||!/^[a-f0-9]{64}$/.test(payload.id)))throw invalid('Invalid historical change id.');
    if(['vcs/commit','vcs/commit-compare','vcs/file-history','vcs/blame','vcs/tree','vcs/tree-file','vcs/tree-segment','vcs/commit-image'].includes(endpoint)){
      if(typeof payload.commit!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(payload.commit))throw invalid('Invalid commit id.');
      if(payload.parentIndex!==undefined&&(!Number.isInteger(payload.parentIndex)||payload.parentIndex<0||payload.parentIndex>100))throw invalid('Invalid parent index.');
    }
    if(['vcs/compare','vcs/commit-compare','vcs/revision-compare'].includes(endpoint)&&payload.large!==undefined&&typeof payload.large!=='boolean')throw invalid('Invalid large comparison mode.');
    if(endpoint==='vcs/tree-segment'&&payload.offset!==undefined&&(!Number.isInteger(payload.offset)||payload.offset<0||payload.offset>16777216))throw invalid('Invalid segment offset.');
    if(endpoint==='vcs/blame'&&((payload.startLine!==undefined&&(!Number.isInteger(payload.startLine)||payload.startLine<1||payload.startLine>100001))||(payload.lineLimit!==undefined&&(!Number.isInteger(payload.lineLimit)||payload.lineLimit<1||payload.lineLimit>500))))throw invalid('Invalid blame line window.');
    if(endpoint==='vcs/file-history'&&payload.follow!==undefined&&typeof payload.follow!=='boolean')throw invalid('Invalid rename follow mode.');
    if(endpoint==='vcs/history'){try{historySearchArgs(payload.search);}catch{throw invalid('Invalid history search.');}}
    if(['vcs/history','vcs/file-history'].includes(endpoint)){
      if(payload.offset===null||payload.limit===null)throw invalid('Invalid history pagination.');
      if(payload.snapshot!==undefined&&(typeof payload.snapshot!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(payload.snapshot)))throw invalid('Invalid history snapshot.');
      if(!Number.isInteger(payload.offset??0)||(payload.offset??0)<0||(payload.offset??0)>10000||!Number.isInteger(payload.limit??50)||(payload.limit??50)<1||(payload.limit??50)>100)throw invalid('Invalid history pagination.');
    }
    if(['vcs/workspace-image','vcs/conflict-stages'].includes(endpoint)&&(typeof payload.id!=='string'||!/^[a-f0-9]{64}$/.test(payload.id)))throw invalid('Invalid workspace image change id.');
    if (!['all', 'unstaged', 'staged'].includes(payload.mode ?? 'all')) throw invalid('Unsupported comparison mode.');
    if (['vcs/compare','vcs/workspace-image'].includes(endpoint) && (typeof payload.id !== 'string' || !payload.id || payload.id.length > 32768)) throw invalid('A change id is required.');
  }
}

/** Dispatch only after grants and capacity have been checked by createHandler. */
async function readRepository(api, endpoint, repository, payload, {cwd, mode, signal}) {
  switch (endpoint) {
    case 'vcs/tree-segment':
      return api.getHistoricalSegment({...repository}, {commit: payload.commit, path: payload.path, offset: payload.offset ?? 0, signal});
    case 'vcs/workspace-image':
      return api.getWorkspaceImage({...repository}, {mode, id: payload.id, side: payload.side ?? 'right', signal});
    case 'vcs/revision-image':
      return api.getRevisionImage({...repository}, {base: payload.base, target: payload.target, id: payload.id, side: payload.side ?? 'right', signal});
    case 'vcs/references':
      return api.listReferences({...repository}, {signal});
    case 'vcs/commit-image':
      return api.getCommitImage({...repository}, {commit: payload.commit, parentIndex: payload.parentIndex ?? 0, id: payload.id, side: payload.side ?? 'right', signal});
    case 'vcs/tree-file':
      return api.getHistoricalFile({...repository}, {commit: payload.commit, path: payload.path, signal});
    case 'vcs/tree':
      return api.getHistoricalTree({...repository}, {commit: payload.commit, signal});
    case 'vcs/blame':
      return api.getFileBlame({...repository}, {commit: payload.commit, parentIndex: payload.parentIndex ?? 0, id: payload.id,
        ...(payload.startLine !== undefined ? {startLine: payload.startLine} : {}),
        ...(payload.lineLimit !== undefined ? {lineLimit: payload.lineLimit} : {}), signal});
    case 'vcs/file-history':
      return api.listFileHistory({...repository}, {commit: payload.commit, parentIndex: payload.parentIndex ?? 0, id: payload.id,
        offset: payload.offset ?? 0, limit: payload.limit ?? 50,
        ...(payload.follow !== undefined ? {follow: payload.follow} : {}), signal});
    case 'vcs/revision-changes':
      return api.getRevisionChanges({...repository}, {base: payload.base, target: payload.target, signal});
    case 'vcs/revision-compare':
      return api.getRevisionComparison({...repository}, {base: payload.base, target: payload.target, id: payload.id, ...(payload.large !== undefined ? {large: payload.large} : {}), signal});
    case 'vcs/commit-compare':
      return api.getCommitComparison({...repository}, {commit: payload.commit, parentIndex: payload.parentIndex ?? 0, id: payload.id, ...(payload.large !== undefined ? {large: payload.large} : {}), signal});
    case 'vcs/commit':
      return api.getCommitDetails({...repository}, {commit: payload.commit, parentIndex: payload.parentIndex ?? 0, signal});
    case 'vcs/history':
      return api.listHistory({...repository}, {snapshot: payload.snapshot, search: payload.search, offset: payload.offset ?? 0, limit: payload.limit ?? 50, signal});
    case 'vcs/status':
      return {cwd, repository: {...repository}, changes: await api.listChanges({...repository}, mode), mode};
    case 'vcs/conflict-stages':
      return api.getConflictStages({...repository},{mode,id:payload.id,signal});
    case 'vcs/compare':
      return api.getComparison({...repository}, {mode, id: payload.id, ...(payload.large !== undefined ? {large: payload.large,signal} : {})});
  }
}

/** Limit active adapter operations and retain only bounded, short-lived discovery grants. */
export function createHandler(ctx, api = adapter, maxActive = 4, { now = Date.now, ttlMs = 5 * 60_000, maxSessions = 32, maxRepositories = 512, bindSvnIdentityResolver } = {}) {
  let active = 0, activeImages = 0, activeSegments = 0;
  const sessions = new Map();
  function current(sessionId, cwd) {
    for (const [id, entry] of sessions) if (entry.expiresAt <= now()) sessions.delete(id);
    const entry = sessions.get(sessionId);
    if (entry && entry.cwd !== cwd) { sessions.delete(sessionId); return undefined; }
    return entry;
  }
  async function assertCurrent(sessionId, cwd, entry, signal) {
    const latest = await resolveSessionCwd(ctx, sessionId, signal);
    signal?.throwIfAborted();
    if (current(sessionId, latest) !== entry || latest !== cwd) throw rediscover();
  }
  if(bindSvnIdentityResolver!==undefined){if(typeof bindSvnIdentityResolver!=='function')throw new Error('Invalid internal SVN resolver binding');bindSvnIdentityResolver(async(address,signal)=>{validatePayload('vcs/svn-identity',address);signal?.throwIfAborted();const cwd=await resolveSessionCwd(ctx,address.sessionId,signal),entry=current(address.sessionId,cwd),repository=entry?.repositories.get(address.repositoryId);if(!repository)throw rediscover();if(repository.type!=='svn')throw invalid('SVN working copy required.');const identity=await api.getSvnIdentity({...repository},{signal});await assertCurrent(address.sessionId,cwd,entry,signal);if(entry.repositories.get(address.repositoryId)!==repository)throw rediscover();return {...identity,cwd};});}
  return async (endpoint, payload, signal) => {
    if (!['vcs/svn-identity', 'vcs/repositories', 'vcs/status', 'vcs/compare', 'vcs/conflict-stages', 'vcs/history', 'vcs/commit', 'vcs/commit-compare', 'vcs/revision-changes', 'vcs/revision-compare', 'vcs/file-history', 'vcs/blame', 'vcs/tree', 'vcs/tree-file', 'vcs/tree-segment', 'vcs/commit-image', 'vcs/revision-image', 'vcs/workspace-image', 'vcs/references'].includes(endpoint)) return failure('vcs/not-found', 'Unknown VCS endpoint.');
    if (active >= maxActive) return failure('vcs/busy', 'Too many VCS requests. Please retry.');
    active++;
    let imageSlot=false,segmentSlot=false;
    try {
      signal?.throwIfAborted();
      validatePayload(endpoint, payload);
      const cwd = await resolveSessionCwd(ctx, payload.sessionId, signal);
      signal?.throwIfAborted();
      let entry = current(payload.sessionId, cwd);
      if (endpoint === 'vcs/repositories') {
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
        return { ok: true, value: { cwd, repositories, truncated, warnings } };
      }
      const repository = entry?.repositories.get(payload.repositoryId);
      if (!repository) throw rediscover();
      if(endpoint==='vcs/svn-identity'){
        if(repository.type!=='svn')throw invalid('SVN working copy required.');
        const identity=await api.getSvnIdentity({...repository},{signal});await assertCurrent(payload.sessionId,cwd,entry,signal);if(entry.repositories.get(payload.repositoryId)!==repository)throw rediscover();
        return {ok:true,value:{root:identity.root,uuid:identity.uuid,scope:identity.scope,origin:identity.origin,revision:identity.revision,remoteEnabled:false}};
      }
      const mode = payload.mode ?? 'all';
      if (repository.type === 'svn' && mode !== 'all') throw invalid('SVN supports only all mode.');
      // Both adapter operations revalidate the canonical root; comparison also validates
      // the change ID against fresh status, so do not duplicate a full status scan here.
      if(['vcs/history','vcs/commit','vcs/commit-compare','vcs/revision-changes','vcs/revision-compare','vcs/file-history','vcs/blame','vcs/tree','vcs/tree-file','vcs/tree-segment','vcs/commit-image','vcs/revision-image','vcs/workspace-image','vcs/references'].includes(endpoint)&&repository.type!=='git')throw invalid('History currently supports Git only.');
      if(endpoint==='vcs/tree-segment'||(['vcs/compare','vcs/commit-compare','vcs/revision-compare'].includes(endpoint)&&payload.large===true)){if(activeSegments>=1)return failure('vcs/busy','A text segment is already loading. Please retry.');activeSegments++;segmentSlot=true;}
      if(['vcs/commit-image','vcs/revision-image','vcs/workspace-image'].includes(endpoint)){
        if(activeImages>=2)return failure('vcs/busy','Too many image requests. Please retry.');
        activeImages++;imageSlot=true;
      }
      const value = await readRepository(api, endpoint, repository, payload, {cwd, mode, signal});
      await assertCurrent(payload.sessionId, cwd, entry, signal);
      if (entry.repositories.get(payload.repositoryId) !== repository) throw rediscover();
      return { ok: true, value };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') return failure('vcs/cancelled', 'The request was cancelled.');
      return failure(typeof error?.code === 'string' && error.code.startsWith('vcs/') ? error.code : 'vcs/operation-failed', error instanceof Error ? error.message : String(error));
    } finally { active--; if(imageSlot)activeImages--;if(segmentSlot)activeSegments--; }
  };
}

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
          return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
            'Content-Type': filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
            'Content-Length': String(bytes.byteLength),
            'Cache-Control': 'private, no-cache',
            'X-Content-Type-Options': 'nosniff',
          } });
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
        res.writeHead(200, {'Content-Type': filename.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Content-Length': String(bytes.byteLength), 'Cache-Control':'private, no-cache', 'X-Content-Type-Options':'nosniff'});
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
}
