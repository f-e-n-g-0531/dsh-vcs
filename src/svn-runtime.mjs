import {createHash} from 'node:crypto';

import {validateSvnCommand} from './svn-command-gate.mjs';
import {planSvnComparison} from './svn-comparison-plan.mjs';
import {createSvnConsent} from './svn-consent.mjs';
import {parseSvnDavDetail} from './svn-dav-detail.mjs';
import {parseSvnDavLogPage} from './svn-dav-log.mjs';
import {parseSvnDetail} from './svn-detail.mjs';
import {parseSvnLogPage} from './svn-log.mjs';
import {planSvnDetail,planSvnLog} from './svn-log-plan.mjs';
import {parseSvnNodeKind} from './svn-node-kind.mjs';
import {parseSvnPropertyNames} from './svn-property-names.mjs';
import {parseSvnRevision,previousSvnRevision} from './svn-revision.mjs';
import {svnHistoryTarget} from './svn-target.mjs';

// Every remote read shares one byte budget; the same bound guards comparison text.
const REMOTE_TEXT_LIMIT_BYTES = 2 * 1024 * 1024;
const DEFAULT_TRANSPORT_TIMEOUT_MS = 15000;
const CONSENT_TTL_MS = 300000;
const DEFAULT_PAGE_SIZE = 50;
const CHANGE_ID_PATTERN = /^[a-f0-9]{64}$/;

const assertChangeId = id => {
  if (typeof id !== 'string' || !CHANGE_ID_PATTERN.test(id)) throw Error('Invalid SVN change ID');
};

const selectedMember = (detail, id, kind) => {
  const member = detail.changes.find(change => change.id === id);
  return kind === undefined || member?.kind === kind ? member : undefined;
};

const targetWithoutPeg = target => target.slice(0, target.lastIndexOf('@'));

const opaqueChangeId = (identity, snapshot, revision, change) => createHash('sha256')
  .update(JSON.stringify([identity.root, identity.uuid, identity.scope, snapshot, revision, change]))
  .digest('hex');

// Transport output is untrusted; the same bounds apply to injected implementations.
const normalizeTransportOutput = (value, plan, maxBytes) => {
  if (!(typeof value === 'string' || Buffer.isBuffer(value)) || Buffer.byteLength(value) > maxBytes) {
    throw Error('SVN transport output exceeds byte limit or has invalid type');
  }
  if (Buffer.isBuffer(value) && plan.args[0] !== 'cat') {
    return new TextDecoder('utf-8', {fatal: true}).decode(value);
  }
  return value;
};

// Options for one dispatched remote read; every call shares the fixed text byte bound.
const remoteOptions = (identity, token, signal) => ({
  identity,
  token,
  signal,
  maxBytes: REMOTE_TEXT_LIMIT_BYTES,
});

// Internal coordinator only. Production remote transport is deliberately not provided.
export function createSvnRuntime({
  resolveIdentity,
  transport,
  now = Date.now,
  timeoutMs = DEFAULT_TRANSPORT_TIMEOUT_MS,
  transportFormat = 'cli',
} = {}) {
  if (!['cli', 'dav'].includes(transportFormat)) throw Error('Invalid SVN transport format');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TRANSPORT_TIMEOUT_MS) {
    throw Error('Invalid SVN runtime deadline');
  }
  if (typeof resolveIdentity !== 'function') throw Error('Local identity resolver required');

  let disposed = false;
  const assertLive = () => {
    if (disposed) throw new DOMException('SVN runtime disposed', 'AbortError');
  };

  const inFlight = new Map();
  const cancelToken = token => {
    for (const task of inFlight.get(token) || []) {
      task.controller.abort(new DOMException('SVN consent revoked', 'AbortError'));
    }
  };
  const offers = createSvnConsent({now});
  const grants = createSvnConsent({now, onRevoke: token => cancelToken(token)});

  const remoteEnabled = typeof transport === 'function';
  const assertRemoteEnabled = () => {
    if (!remoteEnabled) throw Error('SVN remote transport disabled');
  };

  // Local identity is re-derived per step; a cached directory must never authorize later IO.
  const resolve = async (address, signal) => {
    assertLive();
    signal?.throwIfAborted();
    const local = await resolveIdentity(address, signal);
    assertLive();
    signal?.throwIfAborted();
    return {
      ...local,
      sessionId: address.sessionId,
      cwd: local.cwd,
      repositoryId: address.repositoryId,
    };
  };

  const localSnapshot = identity => {
    if (identity.revision === undefined) return {};
    parseSvnRevision(identity.revision);
    return {snapshot: identity.revision};
  };

  const authorizedIdentity = async (address, token, signal) => {
    const identity = await resolve(address, signal);
    grants.assert(token, identity);
    return identity;
  };

  const revalidateAfterStep = async (address, token, signal) => {
    signal?.throwIfAborted();
    grants.assert(token, await resolve(address, signal));
  };

  // Every transport call runs under a consent-bound deadline plus an in-step re-authorizer.
  const dispatchWithDeadline = async (plan, options) => {
    assertLive();
    validateSvnCommand(plan, options.identity);

    options.signal?.throwIfAborted();
    grants.assert(options.token, options.identity);

    const controller = new AbortController();
    const abort = () => controller.abort(options.signal.reason);
    options.signal?.addEventListener('abort', abort, {once: true});

    const task = {controller, sessionId: options.identity.sessionId};
    if (!inFlight.has(options.token)) inFlight.set(options.token, new Set());
    inFlight.get(options.token).add(task);

    const timer = setTimeout(
      () => controller.abort(new DOMException('SVN transport deadline exceeded', 'TimeoutError')),
      timeoutMs,
    );

    try {
      const assertAuthorized = async () => {
        controller.signal.throwIfAborted();
        const current = await resolve(
          {sessionId: options.identity.sessionId, repositoryId: options.identity.repositoryId},
          controller.signal,
        );
        grants.assert(options.token, current);
        controller.signal.throwIfAborted();
      };

      const value = await transport(plan, {
        ...options,
        timeoutMs,
        signal: controller.signal,
        assertAuthorized,
      });
      controller.signal.throwIfAborted();
      return normalizeTransportOutput(value, plan, options.maxBytes);
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw error;
    } finally {
      const tasks = inFlight.get(options.token);
      tasks?.delete(task);
      if (!tasks?.size) inFlight.delete(options.token);
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }
  };

  const runtime = {
    async describe(address, {signal} = {}) {
      const identity = await resolve(address, signal);
      const snapshot = localSnapshot(identity);
      const offer = offers.grant(identity, {explicit: true});
      return {
        ...snapshot,
        offer,
        root: identity.root,
        uuid: identity.uuid,
        scope: identity.scope,
        origin: new URL(identity.root).origin,
        expiresAt: now() + CONSENT_TTL_MS,
        remoteEnabled,
      };
    },

    async approve(address, {offer, explicit = false, signal} = {}) {
      if (explicit !== true) throw Error('Explicit SVN network consent required');
      const identity = await resolve(address, signal);
      offers.assert(offer, identity);
      assertRemoteEnabled();
      const snapshot = localSnapshot(identity);
      const token = grants.grant(identity, {explicit: true});
      offers.revoke(offer);
      return {...snapshot, token, expiresAt: now() + CONSENT_TTL_MS};
    },

    async log(address, {token, snapshot, cursor, limit, path, signal} = {}) {
      const identity = await authorizedIdentity(address, token, signal);
      assertRemoteEnabled();
      const plan = planSvnLog({...identity, snapshot, cursor, limit, path});
      signal?.throwIfAborted();
      const xml = await dispatchWithDeadline(plan, remoteOptions(identity, token, signal));
      await revalidateAfterStep(address, token, signal);
      return (transportFormat === 'dav' ? parseSvnDavLogPage : parseSvnLogPage)(xml, plan);
    },

    async detail(address, {token, snapshot, revision, signal} = {}) {
      const identity = await authorizedIdentity(address, token, signal);
      assertRemoteEnabled();
      const plan = planSvnDetail({...identity, snapshot, revision});
      const xml = await dispatchWithDeadline(plan, remoteOptions(identity, token, signal));
      await revalidateAfterStep(address, token, signal);
      const detail = transportFormat === 'dav'
        ? {...parseSvnDavDetail(xml, plan), pathsAvailable: true}
        : parseSvnDetail(xml, plan);
      return {
        ...detail,
        snapshot,
        changes: detail.changes.map(change => ({
          ...change,
          id: opaqueChangeId(identity, snapshot, revision, change),
        })),
      };
    },

    async compare(address, {token, snapshot, revision, id, signal} = {}) {
      assertChangeId(id);
      const detail = await runtime.detail(address, {token, snapshot, revision, signal});
      const member = selectedMember(detail, id);
      if (!member) throw Error('SVN change is not selected revision member');

      const identity = await authorizedIdentity(address, token, signal);
      const plan = planSvnComparison(
        detail.changes.map(({id: _selectedId, ...change}) => change),
        {scope: identity.scope, revision, path: member.path},
      );

      // Both sides are read at the plan's fixed peg revisions, never from browser input.
      const readRemoteText = async side => {
        if (side.empty) return {label: 'empty', text: '', absent: true};

        const current = await authorizedIdentity(address, token, signal);
        const target = svnHistoryTarget(current.root, side.path, side.pegRevision);
        const options = remoteOptions(current, token, signal);

        // Property names are probed before content so special files never reach cat.
        const properties = await dispatchWithDeadline({
          args: [
            'proplist', '--xml', '--non-interactive', '--no-auth-cache', '-r',
            side.revision, '--', target,
          ],
        }, options);
        await revalidateAfterStep(address, token, signal);
        if (parseSvnPropertyNames(properties, {
          target: targetWithoutPeg(target),
          allowEmpty: true,
        }).special) throw Error('SVN special files cannot be compared');

        const bytes = await dispatchWithDeadline({
          args: [
            'cat', '--non-interactive', '--no-auth-cache', '-r',
            side.revision, '--', target,
          ],
        }, options);
        await revalidateAfterStep(address, token, signal);

        const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        if (buffer.length > REMOTE_TEXT_LIMIT_BYTES) throw Error('SVN text exceeds 2 MiB');
        if (buffer.includes(0)) return {label: 'r' + side.revision, text: '', binary: true};
        let text;
        try {
          text = new TextDecoder('utf-8', {fatal: true}).decode(buffer);
        } catch {
          return {label: 'r' + side.revision, text: '', binary: true};
        }
        return {label: 'r' + side.revision, text};
      };

      // R describes the new node kind, not the historical one. Never cat a replaced directory.
      const historicalNodeKind = async side => {
        const current = await authorizedIdentity(address, token, signal);
        const target = svnHistoryTarget(current.root, side.path, side.pegRevision);
        const xml = await dispatchWithDeadline({
          args: [
            'info', '--xml', '--non-interactive', '--no-auth-cache', '-r',
            side.revision, '--', target,
          ],
        }, remoteOptions(current, token, signal));
        await revalidateAfterStep(address, token, signal);
        return parseSvnNodeKind(xml, {
          target: targetWithoutPeg(target),
          revision: side.revision,
          root: current.root,
          uuid: current.uuid,
        });
      };
      let leftSide = plan.left;
      if (member.action === 'R' && !leftSide.empty && await historicalNodeKind(leftSide) === 'dir') {
        leftSide = {empty: true};
      }

      const left = await readRemoteText(leftSide);
      const right = await readRemoteText(plan.right);
      return {
        path: member.path,
        revision,
        snapshot,
        left,
        right,
        binary: !!(left.binary || right.binary),
      };
    },

    async trace(address, {
      token,
      snapshot,
      revision,
      id,
      cursor,
      limit = DEFAULT_PAGE_SIZE,
      signal,
    } = {}) {
      assertChangeId(id);
      const detail = await runtime.detail(address, {token, snapshot, revision, signal});
      const member = selectedMember(detail, id, 'file');
      if (!member) throw Error('SVN tracing requires selected file member');

      const peg = member.action === 'D' ? previousSvnRevision(revision) : revision;
      const page = await runtime.log(address, {
        token,
        snapshot: peg,
        cursor: cursor ?? peg,
        limit,
        path: member.path,
        signal,
      });
      return {
        ...page,
        selectionSnapshot: snapshot,
        selectionRevision: revision,
        path: member.path,
        pegRevision: peg,
        stopOnCopy: true,
        copySourceOutsideScope: !!member.copySourceOutsideScope,
      };
    },

    async copytrace(address, {
      token,
      snapshot,
      revision,
      id,
      cursor,
      limit = DEFAULT_PAGE_SIZE,
      signal,
    } = {}) {
      assertChangeId(id);
      const detail = await runtime.detail(address, {token, snapshot, revision, signal});
      const member = selectedMember(detail, id, 'file');
      if (
        !member ||
        member.copySourceOutsideScope ||
        member.copyFromPath === undefined ||
        member.copyFromRevision === undefined
      ) throw Error('Selected file has no authorized copy source');

      const peg = member.copyFromRevision;
      const page = await runtime.log(address, {
        token,
        snapshot: peg,
        cursor: cursor ?? peg,
        limit,
        path: member.copyFromPath,
        signal,
      });
      return {
        ...page,
        selectionSnapshot: snapshot,
        selectionRevision: revision,
        path: member.copyFromPath,
        pegRevision: peg,
        sourceForPath: member.path,
        stopOnCopy: true,
      };
    },

    async revoke(address, {token, signal} = {}) {
      await authorizedIdentity(address, token, signal);
      grants.revoke(token);
      cancelToken(token);
      return {revoked: true};
    },

    dispose() {
      disposed = true;
      offers.clear();
      grants.clear();
      for (const token of inFlight.keys()) cancelToken(token);
    },

    revokeSession(sessionId) {
      offers.revokeSession(sessionId);
      grants.revokeSession(sessionId);
      for (const [token, tasks] of inFlight) {
        if ([...tasks].some(task => task.sessionId === sessionId)) cancelToken(token);
      }
    },
  };
  return runtime;
}
