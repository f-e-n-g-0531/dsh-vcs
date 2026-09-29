import { readFile } from 'node:fs/promises';
import * as adapter from './vcs.mjs';

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

function validatePayload(endpoint, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('An object payload is required.');
  const fields = ['vcs/revision-changes','vcs/revision-compare'].includes(endpoint) ? ['sessionId','repositoryId','base','target',...(endpoint==='vcs/revision-compare'?['id']:[])] : endpoint === 'vcs/commit-compare' ? ['sessionId','repositoryId','commit','parentIndex','id'] : endpoint === 'vcs/commit' ? ['sessionId','repositoryId','commit','parentIndex'] : endpoint === 'vcs/history' ? ['sessionId','repositoryId','snapshot','offset','limit'] : endpoint === 'vcs/repositories' ? ['sessionId', 'subdirectory'] : ['sessionId', 'repositoryId', 'mode', ...(endpoint === 'vcs/compare' ? ['id'] : [])];
  if (Object.keys(payload).some(key => !fields.includes(key))) throw invalid('Only Session-addressed repository requests are supported; unknown payload field.');
  if (endpoint === 'vcs/repositories') {
    if (payload.subdirectory !== undefined) {
      const dir = payload.subdirectory;
      if (typeof dir !== 'string' || !dir || dir.length > 4096 || /[\0:]/.test(dir) || /^[\/\\]/.test(dir) || dir.split(/[\/\\]/).includes('..')) throw invalid('subdirectory must be a relative path within the Session directory.');
    }
  } else {
    if (typeof payload.repositoryId !== 'string' || !payload.repositoryId || payload.repositoryId.length > 1024) throw invalid('A discovered repositoryId is required.');
    if(['vcs/revision-changes','vcs/revision-compare'].includes(endpoint)){
      for(const oid of [payload.base,payload.target])if(typeof oid!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid))throw invalid('Invalid revision commit id.');
      if(endpoint==='vcs/revision-compare'&&(typeof payload.id!=='string'||!/^[a-f0-9]{64}$/.test(payload.id)))throw invalid('Invalid revision change id.');
    }
    if(endpoint==='vcs/commit-compare'&&(typeof payload.id!=='string'||!/^[a-f0-9]{64}$/.test(payload.id)))throw invalid('Invalid historical change id.');
    if(['vcs/commit','vcs/commit-compare'].includes(endpoint)){
      if(typeof payload.commit!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(payload.commit))throw invalid('Invalid commit id.');
      if(payload.parentIndex!==undefined&&(!Number.isInteger(payload.parentIndex)||payload.parentIndex<0||payload.parentIndex>100))throw invalid('Invalid parent index.');
    }
    if(endpoint==='vcs/history'){
      if(payload.offset===null||payload.limit===null)throw invalid('Invalid history pagination.');
      if(payload.snapshot!==undefined&&(typeof payload.snapshot!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(payload.snapshot)))throw invalid('Invalid history snapshot.');
      if(!Number.isInteger(payload.offset??0)||(payload.offset??0)<0||(payload.offset??0)>10000||!Number.isInteger(payload.limit??50)||(payload.limit??50)<1||(payload.limit??50)>100)throw invalid('Invalid history pagination.');
    }
    if (!['all', 'unstaged', 'staged'].includes(payload.mode ?? 'all')) throw invalid('Unsupported comparison mode.');
    if (endpoint === 'vcs/compare' && (typeof payload.id !== 'string' || !payload.id || payload.id.length > 32768)) throw invalid('A change id is required.');
  }
}

/** Limit active adapter operations and retain only bounded, short-lived discovery grants. */
export function createHandler(ctx, api = adapter, maxActive = 4, { now = Date.now, ttlMs = 5 * 60_000, maxSessions = 32, maxRepositories = 512 } = {}) {
  let active = 0;
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
  return async (endpoint, payload, signal) => {
    if (!['vcs/repositories', 'vcs/status', 'vcs/compare', 'vcs/history', 'vcs/commit', 'vcs/commit-compare', 'vcs/revision-changes', 'vcs/revision-compare'].includes(endpoint)) return failure('vcs/not-found', 'Unknown VCS endpoint.');
    if (active >= maxActive) return failure('vcs/busy', 'Too many VCS requests. Please retry.');
    active++;
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
      const mode = payload.mode ?? 'all';
      if (repository.type === 'svn' && mode !== 'all') throw invalid('SVN supports only all mode.');
      // Both adapter operations revalidate the canonical root; comparison also validates
      // the change ID against fresh status, so do not duplicate a full status scan here.
      if(['vcs/history','vcs/commit','vcs/commit-compare','vcs/revision-changes','vcs/revision-compare'].includes(endpoint)&&repository.type!=='git')throw invalid('History currently supports Git only.');
      const value = endpoint === 'vcs/revision-changes'
        ? await api.getRevisionChanges({...repository},{base:payload.base,target:payload.target,signal})
        : endpoint === 'vcs/revision-compare'
        ? await api.getRevisionComparison({...repository},{base:payload.base,target:payload.target,id:payload.id,signal})
        : endpoint === 'vcs/commit-compare'
        ? await api.getCommitComparison({...repository},{commit:payload.commit,parentIndex:payload.parentIndex??0,id:payload.id,signal})
        : endpoint === 'vcs/commit'
        ? await api.getCommitDetails({...repository},{commit:payload.commit,parentIndex:payload.parentIndex??0,signal})
        : endpoint === 'vcs/history'
        ? await api.listHistory({...repository},{snapshot:payload.snapshot,offset:payload.offset??0,limit:payload.limit??50,signal})
        : endpoint === 'vcs/status'
        ? { cwd, repository: { ...repository }, changes: await api.listChanges({ ...repository }, mode), mode }
        : await api.getComparison({ ...repository }, { mode, id: payload.id });
      await assertCurrent(payload.sessionId, cwd, entry, signal);
      if (entry.repositories.get(payload.repositoryId) !== repository) throw rediscover();
      return { ok: true, value };
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') return failure('vcs/cancelled', 'The request was cancelled.');
      return failure(typeof error?.code === 'string' && error.code.startsWith('vcs/') ? error.code : 'vcs/operation-failed', error instanceof Error ? error.message : String(error));
    } finally { active--; }
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
  ctx.connection.register(ctx, RPC_CHANNEL, createHandler(ctx));
  registerAssets(ctx);
  registerDirectAssets(ctx);
}
