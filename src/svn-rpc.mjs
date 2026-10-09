import {parseSvnRevision} from './svn-revision.mjs';

const FIELDS = {
  revoke: ['token'],
  describe: [],
  approve: ['offer', 'explicit'],
  log: ['token', 'snapshot', 'cursor', 'limit'],
  detail: ['token', 'snapshot', 'revision'],
  compare: ['token', 'snapshot', 'revision', 'id'],
  trace: ['token', 'snapshot', 'revision', 'id', 'cursor', 'limit'],
};

function validatePayload(method, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw Error('Object payload required');
  }
  if (Object.keys(payload).some(k => !['sessionId', 'repositoryId', ...FIELDS[method]].includes(k))) {
    throw Error('Unknown SVN request field');
  }
  for (const k of ['sessionId', 'repositoryId']) {
    if (typeof payload[k] !== 'string' || !payload[k] || payload[k].length > 1024 || payload[k].includes('\0')) {
      throw Error('Invalid SVN Session address');
    }
  }
  if (method === 'approve') {
    if (payload.explicit !== true || typeof payload.offer !== 'string' || !/^[a-f0-9]{64}$/.test(payload.offer)) {
      throw Error('Explicit scoped offer required');
    }
  }
  if (!['describe', 'approve'].includes(method)) {
    if (typeof payload.token !== 'string' || !/^[a-f0-9]{64}$/.test(payload.token)) {
      throw Error('SVN consent token required');
    }
    if (method !== 'revoke') parseSvnRevision(payload.snapshot);
    if (payload.revision !== undefined) parseSvnRevision(payload.revision);
    if (['detail', 'compare', 'trace'].includes(method) && payload.revision === undefined) {
      throw Error('Selected SVN revision required');
    }
    if (payload.cursor !== undefined) parseSvnRevision(payload.cursor);
    if (payload.limit !== undefined && (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 100)) {
      throw Error('Invalid SVN page size');
    }
    if (['compare', 'trace'].includes(method) && (typeof payload.id !== 'string' || !/^[a-f0-9]{64}$/.test(payload.id))) {
      throw Error('Selected SVN change ID required');
    }
  }
}

// Strict public envelope; runtime owns authorization and transport cleanup.
export function createSvnRpc(runtime, {timeoutMs = 15000} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) {
    throw Error('Invalid SVN RPC deadline');
  }
  let active = 0;
  return async (endpoint, payload, signal) => {
    const method = endpoint.startsWith('vcs/svn-') ? endpoint.slice(8) : '';
    if (!Object.hasOwn(FIELDS, method)) {
      return {ok: false, error: {code: 'vcs/not-found', message: 'Unknown SVN endpoint'}};
    }
    // Revoke must remain available even when history slots are saturated.
    if (method !== 'revoke' && active >= 2) {
      return {ok: false, error: {code: 'vcs/busy', message: 'SVN history requests busy'}};
    }
    if (method !== 'revoke') active++;
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(
      new DOMException('SVN operation deadline exceeded', 'TimeoutError'),
    ), timeoutMs);

    try {
      signal?.throwIfAborted();
      validatePayload(method, payload);
      const {sessionId, repositoryId, ...options} = payload;
      const value = await runtime[method]({sessionId, repositoryId}, {
        ...options, signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      return {ok: true, value};
    } catch (error) {
      const code = signal?.aborted || error?.name === 'AbortError'
        ? 'vcs/cancelled'
        : ['vcs/rediscover-required', 'vcs/svn-consent-required'].includes(error?.code)
          ? error.code
          : 'vcs/operation-failed';
      const reason = controller.signal.aborted ? controller.signal.reason : error;
      const message = reason instanceof Error ? reason.message : String(reason);
      return {ok: false, error: {code, message}};
    } finally {
      // Awaited runtime completion includes lower-layer cleanup before slot release.
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (method !== 'revoke') active--;
    }
  };
}
