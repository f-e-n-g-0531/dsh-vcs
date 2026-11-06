import { readFile } from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {registerFrontendAssets} from './frontend-assets.mjs';
const runningFrontend=JSON.parse(readFileSync(new URL('./dist/frontend.json',import.meta.url),'utf8'));
import * as adapter from './vcs.mjs';
import * as branchAdapter from './branch-switch.mjs';
import {createIndexUnstageCoordinator} from './index-change-host.mjs';
import {createIndexStageCoordinator} from './index-stage-host.mjs';
import {createCommitCoordinator} from './commit-host.mjs';
import {createAmendCoordinator} from './amend-host.mjs';
import {createBranchCreateCoordinator} from './branch-create-host.mjs';
import {createTagCreateCoordinator} from './tag-create-host.mjs';
import {createLightweightTagCoordinator} from './lightweight-tag-host.mjs';
import {encodeGitTag} from './src/git-tag-object.mjs';
import {createPartialStageCoordinator} from './partial-stage-host.mjs';
import {createPartialUnstageCoordinator} from './partial-unstage-host.mjs';
import {createLineStageCoordinator,createLineUnstageCoordinator} from './line-index-host.mjs';
import {createBranchSwitchCoordinator,acquireRepositoryAccess} from './branch-switch-host.mjs';
import {withOperationBudget} from './src/operation-budget.mjs';
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
  'vcs/branches': ['sessionId', 'repositoryId'],
  'vcs/latest-commit': ['sessionId', 'repositoryId'],
  'vcs/branch-delete-preview': ['sessionId', 'repositoryId', 'name'],
  'vcs/commit-prepare': ['sessionId', 'repositoryId', 'author', 'committer', 'message'],
  'vcs/commit-confirm': ['sessionId', 'repositoryId', 'token'],
  'vcs/amend-prepare': ['sessionId', 'repositoryId', 'committer', 'message'],
  'vcs/amend-confirm': ['sessionId', 'repositoryId', 'token'],
  'vcs/branch-create-prepare': ['sessionId', 'repositoryId', 'name'],
  'vcs/branch-create-confirm': ['sessionId', 'repositoryId', 'token'],
  'vcs/lightweight-tag-prepare': ['sessionId', 'repositoryId', 'name'],
  'vcs/lightweight-tag-confirm': ['sessionId', 'repositoryId', 'token'],
  'vcs/tag-create-prepare': ['sessionId', 'repositoryId', 'name', 'tagger', 'message'],
  'vcs/tag-create-confirm': ['sessionId', 'repositoryId', 'token'],
  'vcs/branch-switch-prepare': ['sessionId', 'repositoryId', 'branch'],
  'vcs/branch-switch-confirm': ['sessionId', 'repositoryId', 'token'],
  'vcs/index-unstage-prepare': ['sessionId', 'repositoryId', 'id'],
  'vcs/index-unstage-confirm': ['sessionId', 'repositoryId', 'token'],
  'vcs/index-stage-prepare': ['sessionId', 'repositoryId', 'id'],
  'vcs/index-stage-confirm': ['sessionId', 'repositoryId', 'token'],
  'vcs/partial-stage-plan': ['sessionId', 'repositoryId', 'id'],
  'vcs/partial-stage-prepare': ['sessionId', 'repositoryId', 'planToken', 'unitIds'],
  'vcs/partial-stage-confirm': ['sessionId', 'repositoryId', 'token'],
  'vcs/partial-unstage-plan': ['sessionId', 'repositoryId', 'id'],
  'vcs/partial-unstage-prepare': ['sessionId', 'repositoryId', 'planToken', 'unitIds'],
  'vcs/partial-unstage-confirm': ['sessionId', 'repositoryId', 'token'],
  'vcs/line-stage-plan': ['sessionId', 'repositoryId', 'id'],
  'vcs/line-stage-prepare': ['sessionId', 'repositoryId', 'planToken', 'operationIds'],
  'vcs/line-stage-confirm': ['sessionId', 'repositoryId', 'token'],
  'vcs/line-unstage-plan': ['sessionId', 'repositoryId', 'id'],
  'vcs/line-unstage-prepare': ['sessionId', 'repositoryId', 'planToken', 'operationIds'],
  'vcs/line-unstage-confirm': ['sessionId', 'repositoryId', 'token'],
  'vcs/stash-list': ['sessionId', 'repositoryId'],
  'vcs/reflog': ['sessionId', 'repositoryId'],
  'vcs/grep': ['sessionId', 'repositoryId', 'commit', 'query', 'cursor', 'limit'],
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
  'vcs/tree-page': ['sessionId', 'repositoryId', 'commit', 'path', 'offset', 'limit', 'query'],
  'vcs/tree-file': ['sessionId', 'repositoryId', 'commit', 'path'],
  'vcs/tree-segment': ['sessionId', 'repositoryId', 'commit', 'path', 'offset', 'line'],
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
const COMMIT_ENDPOINTS = new Set(['vcs/commit', 'vcs/commit-compare', 'vcs/file-history', 'vcs/blame', 'vcs/tree', 'vcs/tree-page', 'vcs/tree-file', 'vcs/tree-segment', 'vcs/tree-history', 'vcs/commit-image']);
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
  if (endpoint === 'vcs/tree-page' && (path === undefined || path === '')) return;
  if (endpoint !== 'vcs/tree-page' && !HISTORICAL_PATH_ENDPOINTS.has(endpoint)) return;
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
  if (payload.cursor !== undefined && (typeof payload.cursor !== 'string' || !payload.cursor || payload.cursor.length > 4096 || !payload.commit)) throw invalid('Invalid content search cursor.');
  if (payload.limit !== undefined && (!Number.isInteger(payload.limit) || payload.limit < 1 || payload.limit > 100)) throw invalid('Invalid content search page size.');
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
  if(endpoint==='vcs/branch-switch-prepare'&&(typeof payload.branch!=='string'||!payload.branch||payload.branch.length>1024||/[\0\r\n]/.test(payload.branch)))throw invalid('A local branch name is required.');
  if(endpoint==='vcs/branch-switch-confirm'&&(typeof payload.token!=='string'||! /^[a-f0-9]{64}$/.test(payload.token)))throw invalid('A valid branch confirmation token is required.');
  if(endpoint==='vcs/index-unstage-prepare'&&(typeof payload.id!=='string'||!isChangeId(payload.id)))throw invalid('A valid staged change id is required.');
  if((endpoint==='vcs/index-unstage-confirm'||endpoint==='vcs/index-stage-confirm')&&(typeof payload.token!=='string'||! /^[a-f0-9]{64}$/.test(payload.token)))throw invalid('A valid index confirmation token is required.');
  if(endpoint==='vcs/index-stage-prepare'&&(typeof payload.id!=='string'||!isChangeId(payload.id)))throw invalid('A valid unstaged change id is required.');
  validateHistoricalPath(endpoint, payload.path);
  validateImageSide(endpoint, payload.side);
  validateRevisionSelection(endpoint, payload);
  validateSelectedChangeId(endpoint, payload);
  validateCommitSelection(endpoint, payload);
  validateLargeComparison(endpoint, payload);
  if (endpoint === 'vcs/tree-segment' && payload.offset !== undefined && (!Number.isInteger(payload.offset) || payload.offset < 0 || payload.offset > 16777216)) throw invalid('Invalid segment offset.');
  if (endpoint === 'vcs/tree-segment' && payload.line !== undefined && (!Number.isSafeInteger(payload.line) || payload.line < 1 || payload.line > 16777217 || payload.offset !== undefined)) throw invalid('Invalid segment target line.');
  validateBlameWindow(endpoint, payload);
  validateContentSearch(endpoint, payload);
  validateRenameFollow(endpoint, payload);
  validateHistoryDates(endpoint, payload);
  if (endpoint === 'vcs/history') { try { historySearchArgs(payload.search); } catch { throw invalid('Invalid history search.'); } }
  validateHistoryPagination(endpoint, payload);
  if (endpoint === 'vcs/tree-page') {
    const {offset = 0, limit = 100} = payload;
    if (payload.query !== undefined && (typeof payload.query !== 'string' || payload.query.length > 1024 || /[\0\r\n]/.test(payload.query))) throw invalid('Invalid tree query.');
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid('Invalid tree pagination.');
  }
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

// Snapshot block/line index addresses without invoking browser-owned getters.
const PARTIAL_INDEX_ENDPOINTS = new Set(['vcs/partial-stage-plan', 'vcs/partial-stage-prepare', 'vcs/partial-stage-confirm', 'vcs/partial-unstage-plan', 'vcs/partial-unstage-prepare', 'vcs/partial-unstage-confirm']);
const LINE_INDEX_ENDPOINTS = new Set(['vcs/line-stage-plan', 'vcs/line-stage-prepare', 'vcs/line-stage-confirm', 'vcs/line-unstage-plan', 'vcs/line-unstage-prepare', 'vcs/line-unstage-confirm']);
function selectedIndexPayload(endpoint, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('An object payload is required.');
  const fields = REQUEST_FIELDS[endpoint], keys = Reflect.ownKeys(payload), copy = Object.create(null);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) throw invalid('Partial index operations require the exact payload fields.');
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(payload, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid('Partial index fields must be own data properties.');
    copy[key] = descriptor.value;
  }
  const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (endpoint.endsWith('-plan') && !hex(copy.id)) throw invalid(endpoint.endsWith('-stage-plan') ? 'A valid unstaged change id is required.' : 'A valid staged change id is required.');
  if (endpoint.endsWith('-confirm') && !hex(copy.token)) throw invalid('A valid index confirmation token is required.');
  if (endpoint.endsWith('-prepare')) {
    if (!hex(copy.planToken)) throw invalid('A valid partial index plan token is required.');
    const line = LINE_INDEX_ENDPOINTS.has(endpoint), field = line ? 'operationIds' : 'unitIds', limit = line ? 8000 : 4000;
    const ids = copy[field];
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > limit) throw invalid(`Select between 1 and ${limit} unique ${line ? 'operation' : 'unit'} IDs.`);
    const values = [];
    if (Reflect.ownKeys(ids).length !== ids.length + 1) throw invalid('Unit IDs must contain only own array entries.');
    for (let i = 0; i < ids.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(ids, String(i));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !hex(descriptor.value)) throw invalid('Unit IDs must be own hexadecimal data properties.');
      values.push(descriptor.value);
    }
    if (new Set(values).size !== values.length) throw invalid('Unit IDs must be unique.');
    copy[field] = values;
  }
  return copy;
}

// Snapshot commit requests before budgets, awaits or Session lookup; never invoke getters.
const COMMIT_WRITE_ENDPOINTS = new Set(['vcs/commit-prepare', 'vcs/commit-confirm']);
const AMEND_WRITE_ENDPOINTS = new Set(['vcs/amend-prepare', 'vcs/amend-confirm']);
function commitRecord(value, fields) {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid('Commit fields require plain records.');
  const keys = Reflect.ownKeys(value), copy = Object.create(null);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) throw invalid('Commit requests require exactly the declared fields.');
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid('Commit fields must be own data properties.');
    copy[key] = descriptor.value;
  }
  return copy;
}
function commitText(value, limit) {
  if (typeof value !== 'string' || value.length > limit || Buffer.byteLength(value, 'utf8') > limit || Buffer.from(value, 'utf8').toString('utf8') !== value || !value.trim()) throw invalid('Commit text must be nonblank bounded strict UTF-8.');
}
function commitIdentity(value) {
  const copy = commitRecord(value, ['name', 'email', 'timestamp', 'timezone']);
  for (const key of ['name', 'email']) {
    commitText(copy[key], 1024);
    if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/u.test(copy[key])) throw invalid('Unsafe commit identity.');
  }
  if (!Number.isSafeInteger(copy.timestamp) || copy.timestamp < 0) throw invalid('Invalid commit identity timestamp.');
  if (typeof copy.timezone !== 'string' || !/^[-+][0-9]{4}$/.test(copy.timezone)) throw invalid('Invalid commit identity timezone.');
  const hours = Number(copy.timezone.slice(1, 3)), minutes = Number(copy.timezone.slice(3));
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) throw invalid('Invalid commit identity timezone.');
  return Object.freeze(copy);
}
function commitPayload(endpoint, payload) {
  const copy = commitRecord(payload, REQUEST_FIELDS[endpoint]);
  if (typeof copy.sessionId !== 'string' || !copy.sessionId || copy.sessionId.length > 256 || /[/\\\0]/.test(copy.sessionId)) throw invalid('A valid sessionId is required.');
  if (typeof copy.repositoryId !== 'string' || !copy.repositoryId || copy.repositoryId.length > 1024) throw invalid('A discovered repositoryId is required.');
  if (endpoint === 'vcs/commit-confirm' || endpoint === 'vcs/amend-confirm') {
    if (typeof copy.token !== 'string' || !/^[a-f0-9]{64}$/.test(copy.token)) throw invalid('A valid commit confirmation token is required.');
  } else {
    if (endpoint === 'vcs/commit-prepare') copy.author = commitIdentity(copy.author);
    copy.committer = commitIdentity(copy.committer);
    commitText(copy.message, 64 * 1024);
    if (/[\p{Cf}\p{Zl}\p{Zp}]/u.test(copy.message) || /[\p{Cc}]/u.test(copy.message.replace(/[\n\t]/g, ''))) throw invalid('Unsafe commit message controls.');
  }
  return Object.freeze(copy);
}

// Capture tag inputs before budgets and Session lookup; HEAD/target authority stays server-side.
const TAG_CREATE_ENDPOINTS = new Set(['vcs/tag-create-prepare', 'vcs/tag-create-confirm']);
function tagCreatePayload(endpoint, payload) {
  const copy = commitRecord(payload, REQUEST_FIELDS[endpoint]);
  if (typeof copy.sessionId !== 'string' || !copy.sessionId || copy.sessionId.length > 256 || /[/\\\0]/.test(copy.sessionId)) throw invalid('A valid sessionId is required.');
  if (typeof copy.repositoryId !== 'string' || !copy.repositoryId || copy.repositoryId.length > 1024) throw invalid('A discovered repositoryId is required.');
  if (endpoint === 'vcs/tag-create-confirm') {
    if (typeof copy.token !== 'string' || !/^[a-f0-9]{64}$/.test(copy.token)) throw invalid('A valid tag creation confirmation token is required.');
  } else {
    copy.tagger = Object.freeze(commitRecord(copy.tagger, ['name', 'email', 'timestamp', 'timezone']));
    if (typeof copy.message !== 'string') throw invalid('A string tag message is required.');
    try { encodeGitTag({object:'1'.repeat(40), tag:copy.name, tagger:copy.tagger, message:copy.message}); }
    catch { throw invalid('Invalid tag name, identity or message.'); }
  }
  return Object.freeze(copy);
}

// Branch creation accepts only a portable short name, never execution authority.
const LIGHTWEIGHT_TAG_ENDPOINTS = new Set(['vcs/lightweight-tag-prepare', 'vcs/lightweight-tag-confirm']);
const BRANCH_CREATE_ENDPOINTS = new Set(['vcs/branch-create-prepare', 'vcs/branch-create-confirm']);
function branchCreatePayload(endpoint, payload) {
  const copy = commitRecord(payload, REQUEST_FIELDS[endpoint]);
  if (typeof copy.sessionId !== 'string' || !copy.sessionId || copy.sessionId.length > 256 || /[/\\\0]/.test(copy.sessionId)) throw invalid('A valid sessionId is required.');
  if (typeof copy.repositoryId !== 'string' || !copy.repositoryId || copy.repositoryId.length > 1024) throw invalid('A discovered repositoryId is required.');
  if (endpoint.endsWith('-confirm')) {
    if (typeof copy.token !== 'string' || !/^[a-f0-9]{64}$/.test(copy.token)) throw invalid('A valid branch creation confirmation token is required.');
  } else {
    const name = copy.name;
    // Keep byte bounds and portable grammar aligned with branch-create-preview.
    if (typeof name !== 'string' || !name || Buffer.from(name, 'utf8').toString('utf8') !== name || Buffer.byteLength(name, 'utf8') > 1000 ||
      name === '@' || name.toUpperCase() === 'HEAD' || name.startsWith('-') || name.startsWith('refs/') || /[\x00-\x20\x7f~^:?*\[\\<>"|\p{Cc}\p{Cf}]/u.test(name) || name.includes('..') || name.includes('@{') ||
      name.split('/').some(part => !part || Buffer.byteLength(part, 'utf8') > 255 || part.startsWith('.') || /[. ]$/.test(part) || part.toLowerCase().endsWith('.lock') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw invalid('Safe portable short branch name required.');
  }
  return Object.freeze(copy);
}

// Read-only fixed-HEAD addresses are captured before budgets or Session lookup.
function latestCommitPayload(payload) {
  if (!payload || typeof payload !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(payload))) throw invalid('Latest commit requires a plain record.');
  const fields = REQUEST_FIELDS['vcs/latest-commit'], keys = Reflect.ownKeys(payload), copy = Object.create(null);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) throw invalid('Latest commit requires exactly sessionId and repositoryId.');
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(payload, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw invalid('Latest commit fields must be own data properties.');
    copy[key] = descriptor.value;
  }
  if (typeof copy.sessionId !== 'string' || !copy.sessionId || copy.sessionId.length > 256 || /[/\\\0]/.test(copy.sessionId)) throw invalid('A valid sessionId is required.');
  if (typeof copy.repositoryId !== 'string' || !copy.repositoryId || copy.repositoryId.length > 1024) throw invalid('A discovered repositoryId is required.');
  return Object.freeze(copy);
}

/** Forward an optional field only when the request actually supplied it. */
const optionalField = (key, value) => value === undefined ? {} : {[key]: value};

/** Dispatch only after grants and capacity have been checked by createHandler. */
async function readRepository(api, endpoint, repository, payload, {cwd, mode, signal}) {
  switch (endpoint) {
    case 'vcs/tree-page':
      return api.getHistoricalTreePage({...repository}, {commit: payload.commit, path: payload.path ?? '', offset: payload.offset ?? 0, limit: payload.limit ?? 100, ...optionalField('query', payload.query), signal});
    case 'vcs/tree-history':
      return api.listPathHistory({...repository}, {
        commit: payload.commit, path: payload.path, offset: payload.offset ?? 0, limit: payload.limit ?? 50, follow: payload.follow ?? false,
        ...optionalField('since', payload.since), ...optionalField('until', payload.until), signal,
      });
    case 'vcs/tree-segment':
      return api.getHistoricalSegment({...repository}, {commit: payload.commit, path: payload.path, ...optionalField('offset', payload.offset), ...optionalField('line', payload.line), signal});
    case 'vcs/workspace-image':
      return api.getWorkspaceImage({...repository}, {mode, id: payload.id, side: payload.side ?? 'right', signal});
    case 'vcs/revision-image':
      return api.getRevisionImage({...repository}, {base: payload.base, target: payload.target, id: payload.id, side: payload.side ?? 'right', signal});
    case 'vcs/branch-delete-preview': {
      const summary = await api.prepareBranchDelete({type: repository.type, root: repository.root}, {name: payload.name, signal});
      // Raw summary identity is an internal WeakMap capability: never return or spread it.
      // Copy only public scalar facts and the proof path, never adapter/private extras.
      const {name, ref, objectFormat, current, target, proof, planId} = summary;
      if ([name, ref, objectFormat, current?.ref, current?.oid, target?.ref, target?.oid, planId].some(value => typeof value !== 'string') ||
        summary.merged !== true || !Array.isArray(proof) || proof.some(value => typeof value !== 'string')) throw new Error('Invalid branch deletion preview summary.');
      return Object.freeze({action: 'branch-delete', name, ref, objectFormat,
        current: Object.freeze({ref: current.ref, oid: current.oid}),
        target: Object.freeze({ref: target.ref, oid: target.oid}), merged: true,
        proof: Object.freeze([...proof]), planId});
    }
    case 'vcs/latest-commit':
      return api.readLatestCommit({type: repository.type, root: repository.root}, {signal});
    case 'vcs/references':
      return api.listReferences({...repository}, {signal});
    case 'vcs/stash-list':
      return api.listStashes({...repository}, {signal});
    case 'vcs/reflog':
      return api.listReflog({...repository}, {signal});
    case 'vcs/grep':
      return api.searchRepositoryContent({...repository}, {commit: payload.commit, query: payload.query, ...optionalField('cursor', payload.cursor), ...optionalField('limit', payload.limit), signal});
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
export function createHandler(ctx, api = {...adapter,...branchAdapter}, maxActive = 4, { now = Date.now, ttlMs = 5 * 60_000, maxSessions = 32, maxRepositories = 512, operationTimeoutMs = 15000, bindSvnIdentityResolver } = {}) {
  let active = 0, activeImages = 0, activeSegments = 0;
  const sessions = new Map();
  const branchSwitch=createBranchSwitchCoordinator({api,now});
  const commit=createCommitCoordinator({api,now});
  const amend=createAmendCoordinator({api,now});
  const branchCreate=createBranchCreateCoordinator({api,now});
  const tagCreate=createTagCreateCoordinator({api,now});
  const lightweightTag=createLightweightTagCoordinator({api,now});
  // The wrapper's internal path slot carries an opaque ID, NEVER a filesystem path.
  // Only the guarded selector adapter may resolve it to an exact staged entry.
  const indexUnstage=createIndexUnstageCoordinator({api:{
    prepareIndexUnstage:(repository,{path:id,signal})=>api.prepareSelectedIndexUnstage(repository,{id,signal}),
    applyIndexUnstage:(repository,request)=>api.applyIndexUnstage(repository,request),
  },now});

  // The internal path slot carries an opaque unstaged selection ID, not a path.
  const indexStage=createIndexStageCoordinator({api:{
    prepareIndexStage:(repository,{path:id,signal})=>api.prepareSelectedIndexStage(repository,{id,signal}),
    applyIndexStage:(repository,request)=>api.applyIndexStage(repository,request),
  },now});

  const partialStage=createPartialStageCoordinator({api,now});
  const partialUnstage=createPartialUnstageCoordinator({api,now});
  const lineStage=createLineStageCoordinator({api,now});
  const lineUnstage=createLineUnstageCoordinator({api,now});

  const clearGrantCache = entry => {
    branchSwitch.invalidate(entry);
    branchCreate.invalidate(entry);
    tagCreate.invalidate(entry);
    lightweightTag.invalidate(entry);
    commit.invalidate(entry);
    amend.invalidate(entry);
    indexUnstage.invalidate(entry);
    indexStage.invalidate(entry);
    partialStage.invalidate(entry);
    partialUnstage.invalidate(entry);
    lineStage.invalidate(entry);
    lineUnstage.invalidate(entry);
    for (const repository of entry?.repositories.values() ?? []) api.clearHistoricalCache?.(repository.root);
  };
  const revokeSession = id => { clearGrantCache(sessions.get(id)); sessions.delete(id); };

  /** Resolve a live Session grant, evicting expired entries and cwd-mismatched grants. */
  function current(sessionId, cwd) {
    for (const [id, entry] of sessions) if (entry.expiresAt <= now()) revokeSession(id);
    const entry = sessions.get(sessionId);
    if (entry && entry.cwd !== cwd) { revokeSession(sessionId); return undefined; }
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
      while (sessions.size >= maxSessions) revokeSession(sessions.keys().next().value);
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
    clearGrantCache(entry);
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

  const execute = async (endpoint, payload, signal) => {
    if (UPDATE_ENDPOINTS.has(endpoint)) return handleUpdateRequest(endpoint, payload, signal);
    if (!ACTION_ENDPOINTS.has(endpoint)) return failure('vcs/not-found', 'Unknown VCS endpoint.');
    if (active >= maxActive) return failure('vcs/busy', 'Too many VCS requests. Please retry.');
    active++;
    let imageSlot = false, segmentSlot = false;
    try {
      signal?.throwIfAborted();
      if (PARTIAL_INDEX_ENDPOINTS.has(endpoint) || LINE_INDEX_ENDPOINTS.has(endpoint)) payload = selectedIndexPayload(endpoint, payload);
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
      const authorize=()=>assertCurrentGrant(payload.sessionId,cwd,entry,payload.repositoryId,repository,signal);
      if(endpoint==='vcs/lightweight-tag-confirm'){
        try{return {ok:true,value:await lightweightTag.confirm(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};}
        finally{api.clearHistoricalCache?.(repository.root);}
      }
      if(endpoint==='vcs/tag-create-confirm'){
        try{return {ok:true,value:await tagCreate.confirm(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};}
        finally{api.clearHistoricalCache?.(repository.root);}
      }
      if(endpoint==='vcs/branch-create-confirm'){
        try{return {ok:true,value:await branchCreate.confirm(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};}
        finally{api.clearHistoricalCache?.(repository.root);}
      }
      if(endpoint==='vcs/amend-confirm'){
        try{return {ok:true,value:await amend.confirm(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};}
        finally{api.clearHistoricalCache?.(repository.root);}
      }
      if(endpoint==='vcs/commit-confirm'){
        try{return {ok:true,value:await commit.confirm(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};}
        finally{api.clearHistoricalCache?.(repository.root);}
      }
      if(endpoint==='vcs/branch-switch-confirm'){
        try{return {ok:true,value:await branchSwitch.confirm(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};}
        finally{api.clearHistoricalCache?.(repository.root);}
      }
      if(endpoint==='vcs/index-unstage-confirm'){
        try{return {ok:true,value:await indexUnstage.confirm(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};}
        finally{api.clearHistoricalCache?.(repository.root);}
      }
      if(endpoint==='vcs/index-stage-confirm'){
        try{return {ok:true,value:await indexStage.confirm(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};}
        finally{api.clearHistoricalCache?.(repository.root);}
      }
      if(endpoint==='vcs/partial-stage-confirm'){
        try{return {ok:true,value:await partialStage.confirm(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};}
        finally{api.clearHistoricalCache?.(repository.root);}
      }
      if(endpoint==='vcs/partial-unstage-confirm'){
        try{return {ok:true,value:await partialUnstage.confirm(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};}
        finally{api.clearHistoricalCache?.(repository.root);}
      }
      if(endpoint==='vcs/line-stage-confirm'||endpoint==='vcs/line-unstage-confirm'){
        const coordinator=endpoint==='vcs/line-stage-confirm'?lineStage:lineUnstage;
        try{return {ok:true,value:await coordinator.confirm(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};}
        finally{api.clearHistoricalCache?.(repository.root);}
      }
      const releaseRepository=acquireRepositoryAccess(repository.root);
      try{
      if(endpoint==='vcs/lightweight-tag-prepare')return {ok:true,value:await lightweightTag.prepare(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};
      if(endpoint==='vcs/tag-create-prepare')return {ok:true,value:await tagCreate.prepare(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};
      if(endpoint==='vcs/branch-create-prepare')return {ok:true,value:await branchCreate.prepare(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};
      if(endpoint==='vcs/amend-prepare')return {ok:true,value:await amend.prepare(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};
      if(endpoint==='vcs/commit-prepare')return {ok:true,value:await commit.prepare(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};
      if(endpoint==='vcs/branches'){const value=await api.listLocalBranches({...repository},{signal});await authorize();return {ok:true,value};}
      if(endpoint==='vcs/branch-switch-prepare')return {ok:true,value:await branchSwitch.prepare(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};
      if(endpoint==='vcs/index-unstage-prepare')return {ok:true,value:await indexUnstage.prepare({...payload,path:payload.id},{entry,repository,cwd,signal,assertAuthorized:authorize})};
      if(endpoint==='vcs/index-stage-prepare')return {ok:true,value:await indexStage.prepare({...payload,path:payload.id},{entry,repository,cwd,signal,assertAuthorized:authorize})};
      if(endpoint==='vcs/partial-stage-plan')return {ok:true,value:await partialStage.plan(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};
      if(endpoint==='vcs/partial-stage-prepare')return {ok:true,value:await partialStage.prepare(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};
      if(endpoint==='vcs/partial-unstage-plan')return {ok:true,value:await partialUnstage.plan(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};
      if(endpoint==='vcs/partial-unstage-prepare')return {ok:true,value:await partialUnstage.prepare(payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};
      if(LINE_INDEX_ENDPOINTS.has(endpoint)){
        const coordinator=endpoint.startsWith('vcs/line-stage-')?lineStage:lineUnstage;
        const method=endpoint.endsWith('-plan')?'plan':'prepare';
        return {ok:true,value:await coordinator[method](payload,{entry,repository,cwd,signal,assertAuthorized:authorize})};
      }
      const admission = admitHeavyOperation(endpoint, payload);
      imageSlot = admission.imageSlot;
      segmentSlot = admission.segmentSlot;
      if (admission.busy) return admission.busy;
      return { ok: true, value: await readGrantedRepository(endpoint, repository, payload, cwd, mode, entry, signal) };
      }finally{releaseRepository();}
    } catch (error) {
      if(error?.code==='vcs/lightweight-tag-create-outcome-unknown'||error?.code==='vcs/tag-create-outcome-unknown'||error?.code==='vcs/branch-create-outcome-unknown'||error?.code==='vcs/amend-outcome-unknown'||error?.code==='vcs/commit-outcome-unknown'||error?.code==='vcs/branch-outcome-unknown'||error?.code==='vcs/index-outcome-unknown')return failure(error.code,error.message);
      if (signal?.aborted || error?.name === 'AbortError') return failure('vcs/cancelled', 'The request was cancelled.');
      const code = error?.code === 'TIMEOUT' ? 'vcs/timeout' : typeof error?.code === 'string' && error.code.startsWith('vcs/') ? error.code : 'vcs/operation-failed';
      return failure(code, error instanceof Error ? error.message : String(error));
    } finally {
      active--;
      if (imageSlot) activeImages--;
      if (segmentSlot) activeSegments--;
    }
  };
  const handle=async (endpoint, payload, signal) => {
    let dispatched=false;
    try {
      if (LIGHTWEIGHT_TAG_ENDPOINTS.has(endpoint) || BRANCH_CREATE_ENDPOINTS.has(endpoint) || endpoint === 'vcs/branch-delete-preview') payload = branchCreatePayload(endpoint, payload);
      if (TAG_CREATE_ENDPOINTS.has(endpoint)) payload = tagCreatePayload(endpoint, payload);
      if (endpoint === 'vcs/latest-commit') payload = latestCommitPayload(payload);
      if (COMMIT_WRITE_ENDPOINTS.has(endpoint) || AMEND_WRITE_ENDPOINTS.has(endpoint)) payload = commitPayload(endpoint, payload);
      return await withOperationBudget({signal, timeoutMs: operationTimeoutMs}, () => {dispatched=true;return execute(endpoint, payload, signal);});
    } catch (error) {
      if(error?.code==='vcs/lightweight-tag-create-outcome-unknown'||error?.code==='vcs/tag-create-outcome-unknown'||error?.code==='vcs/branch-create-outcome-unknown'||error?.code==='vcs/amend-outcome-unknown'||error?.code==='vcs/commit-outcome-unknown'||error?.code==='vcs/branch-outcome-unknown'||error?.code==='vcs/index-outcome-unknown')return failure(error.code,error.message);
      if(endpoint==='vcs/lightweight-tag-confirm'&&!dispatched&&signal?.aborted&&error?.code!=='vcs/invalid-request')return failure('vcs/cancelled','The request was cancelled before dispatch.');
      if(endpoint==='vcs/lightweight-tag-confirm' && error?.code!=='vcs/invalid-request')return failure('vcs/lightweight-tag-create-outcome-unknown','Lightweight tag creation confirmation did not complete within its request lifetime. Refresh and inspect refs and HEAD before preparing another lightweight tag creation. Never automatically delete refs, retry, or roll back.');
      if(endpoint==='vcs/tag-create-confirm'&&!dispatched&&signal?.aborted&&error?.code!=='vcs/invalid-request')return failure('vcs/cancelled','The request was cancelled before dispatch.');
      if(endpoint==='vcs/tag-create-confirm' && error?.code!=='vcs/invalid-request')return failure('vcs/tag-create-outcome-unknown','Tag creation confirmation did not complete within its request lifetime. Append-only objects or refs may remain. Refresh and inspect refs, HEAD and objects before preparing another tag creation. Never automatically delete objects or refs, retry, or roll back.');
      if(endpoint==='vcs/branch-create-confirm'&&!dispatched&&signal?.aborted)return failure('vcs/cancelled','The request was cancelled before dispatch.');
      if(endpoint==='vcs/branch-create-confirm' && error?.code!=='vcs/invalid-request')return failure('vcs/branch-create-outcome-unknown','Branch creation confirmation did not complete within its request lifetime. Refresh and inspect refs and HEAD before preparing another branch creation. Never automatically delete refs, retry, or roll back.');
      if(endpoint==='vcs/amend-confirm'&&!dispatched&&signal?.aborted)return failure('vcs/cancelled','The request was cancelled before dispatch.');
      if(endpoint==='vcs/amend-confirm' && error?.code!=='vcs/invalid-request')return failure('vcs/amend-outcome-unknown','Amend rewrites history. Confirmation did not complete within its request lifetime. Append-only object writes may remain even if HEAD was not updated. Refresh and inspect HEAD and the index before preparing another amend. Never retry automatically or roll back appended objects.');
      if(endpoint==='vcs/commit-confirm'&&!dispatched&&signal?.aborted)return failure('vcs/cancelled','The request was cancelled before dispatch.');
      if(endpoint==='vcs/commit-confirm' && error?.code!=='vcs/invalid-request')return failure('vcs/commit-outcome-unknown','Commit confirmation did not complete within its request lifetime. Append-only object writes may remain even if HEAD was not updated. Refresh and inspect HEAD before preparing another commit.');
      if(error?.code==='vcs/invalid-request')return failure(error.code,error.message);
      if(endpoint==='vcs/index-stage-confirm'||endpoint==='vcs/partial-stage-confirm'||endpoint==='vcs/line-stage-confirm')return failure('vcs/index-outcome-unknown','Staging confirmation did not complete within its request lifetime. Append-only object writes may remain even if the index was not updated. Refresh and inspect the index before preparing again.');
      if(endpoint==='vcs/partial-unstage-confirm'||endpoint==='vcs/line-unstage-confirm')return failure('vcs/index-outcome-unknown','Partial unstaging confirmation did not complete within its request lifetime. Append-only object writes may remain even if the index was not updated. Refresh and inspect the index before preparing again.');
      if(endpoint==='vcs/index-unstage-confirm')return failure('vcs/index-outcome-unknown','Confirmation did not complete within its request lifetime. Refresh and inspect the index before preparing again.');
      if(endpoint==='vcs/branch-switch-confirm')return failure('vcs/branch-outcome-unknown','Confirmation did not complete within its request lifetime. Refresh and inspect the current branch before preparing again.');
      if (signal?.aborted || error?.name === 'AbortError') return failure('vcs/cancelled', 'The request was cancelled.');
      return failure(error?.code === 'TIMEOUT' ? 'vcs/timeout' : 'vcs/operation-failed', error.message);
    }
  };
  handle.dispose=()=>{lightweightTag.clear();tagCreate.clear();branchCreate.clear();amend.clear();commit.clear();branchSwitch.clear();indexUnstage.clear();indexStage.clear();partialStage.clear();partialUnstage.clear();lineStage.clear();lineUnstage.clear();for(const id of sessions.keys())revokeSession(id);};
  return handle;
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
  const host=createSvnHttpsHost(ctx,{...adapter,...branchAdapter});
  ctx.effect(()=>()=>{ host.dispose(); adapter.clearHistoricalCache?.(); });
  ctx.connection.register(ctx, RPC_CHANNEL, host.handle);
  registerAssets(ctx);
  registerDirectAssets(ctx);
  registerFrontendAssets(ctx,{running:runningFrontend});
}
