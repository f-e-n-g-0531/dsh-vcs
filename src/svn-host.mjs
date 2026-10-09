import {createHandler} from '../index.mjs';
import {createSvnRuntime} from './svn-runtime.mjs';
import {createSvnRpc} from './svn-rpc.mjs';

const REMOTE_METHODS = new Set(['describe', 'approve', 'log', 'detail', 'compare', 'trace', 'revoke']);

// Shared host authorization; callers must explicitly supply a transport.
export function createSvnHost(ctx, api, {
  transport, transportFormat = 'cli', now = Date.now, timeoutMs = 15000,
} = {}) {
  let resolveIdentity;
  const local = createHandler(ctx, api, 4, {
    now,
    bindSvnIdentityResolver: resolver => { resolveIdentity = resolver; },
  });
  const runtime = createSvnRuntime({resolveIdentity, transport, transportFormat, now, timeoutMs});
  const remote = createSvnRpc(runtime, {timeoutMs});

  return {
    handle(endpoint, payload, signal) {
      const method = endpoint.startsWith('vcs/svn-') ? endpoint.slice(8) : '';
      return REMOTE_METHODS.has(method)
        ? remote(endpoint, payload, signal)
        : local(endpoint, payload, signal);
    },
    revokeSession: sessionId => runtime.revokeSession(sessionId),
    dispose: () => runtime.dispose(),
  };
}
