import { spawn } from 'node:child_process';
import {parseHistory,HISTORY_FORMAT,historyPage} from './git-history.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const MAX_TEXT = 2 * 1024 * 1024;
const MAX_OUTPUT = 16 * 1024 * 1024;
const TIMEOUT = 15000;
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, parseAttributeValue: false, trimValues: false, processEntities: true, isArray: name => ['entry', 'target', 'property'].includes(name) });

function run(command, args, cwd, max = MAX_OUTPUT, { signal, timeoutMs = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Object.assign(new Error('Discovery cancelled'), { code: 'ABORT_ERR' })); return; }
    // Inherited Git overrides must not redirect reads to a different repository.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
    Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', LC_ALL: process.platform === 'linux' ? 'C.UTF-8' : 'en_US.UTF-8' });
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    const out = [], err = []; let size = 0, error, done = false;
    const stop = e => { error ??= e; child.kill(); };
    const abort = () => stop(Object.assign(new Error('Discovery cancelled'), { code: 'ABORT_ERR' }));
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop(Object.assign(new Error(command + ' timed out'), { code: 'TIMEOUT' })), timeoutMs);
    child.stdout.on('data', b => { size += b.length; if (size > max) stop(Object.assign(new Error('Output exceeds size limit'), { code: 'TOO_LARGE' })); else out.push(b); });
    child.stderr.on('data', b => { size += b.length; if (size > max) stop(Object.assign(new Error('Output exceeds size limit'), { code: 'TOO_LARGE' })); else err.push(b); });
    const finish = e => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); if (e) reject(e); else resolve(Buffer.concat(out)); };
    child.on('error', finish);
    child.on('close', code => finish(error || (code !== 0 ? Object.assign(new Error(command + ': ' + Buffer.concat(err).toString('utf8').trim()), { code: 'VCS_COMMAND', exitCode: code }) : null)));
  });
}
const git = (root, args, max, options) => run('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args], root, max, options);
const svn = (root, args, max, options) => run('svn', ['--non-interactive', ...args], root, max, options);
function parseXML(buffer) {
  const text = buffer.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true) throw new Error('Invalid VCS XML');
  return xml.parse(text);
}
function inside(root, candidate) { const rel = path.relative(root, candidate); return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep)); }
async function confined(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\0') || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) throw new Error('Invalid repository path');
  const target = path.resolve(root, relative);
  if (!inside(root, target)) throw new Error('Path escapes repository');
  // Inspect each existing component, including dangling links whose realpath fails.
  let component = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) {
    component = path.join(component, part);
    try {
      if ((await fs.lstat(component)).isSymbolicLink()) {
        const destination = path.resolve(path.dirname(component), await fs.readlink(component));
        if (!inside(root, destination)) throw new Error('Symlink escapes repository');
      }
    } catch (e) { if (!['ENOENT', 'ENOTDIR'].includes(e.code)) throw e; }
  }
  let current = target;
  for (;;) {
    try { const real = await fs.realpath(current); if (!inside(root, real)) throw new Error('Symlink escapes repository'); break; }
    catch (e) { if (!['ENOENT', 'ENOTDIR'].includes(e.code)) throw e; const parent = path.dirname(current); if (parent === current) throw e; current = parent; }
  }
  return target;
}

/** Detect the nearest enclosing Git or SVN working copy; never initializes one. */
export async function detectRepository(cwd) {
  let current;
  try { current = await fs.realpath(cwd); if (!(await fs.stat(current)).isDirectory()) current = path.dirname(current); } catch { return null; }
  for (;;) {
    for (const type of ['git', 'svn']) {
      try { await fs.lstat(path.join(current, '.' + type)); } catch { continue; }
      try {
        if (type === 'git') {
          const root = await fs.realpath((await git(current, ['rev-parse', '--show-toplevel'])).toString('utf8').trim());
          let branch; try { branch = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).toString('utf8').trim(); } catch { branch = (await git(root, ['rev-parse', '--short', 'HEAD'])).toString('utf8').trim(); }
          return { root, type, branch };
        }
        const info = parseXML(await svn(current, ['info', '--xml', '--', '.'])).info.entry[0];
        return { root: await fs.realpath(info['wc-info']['wcroot-abspath']), type };
      } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    }
    const parent = path.dirname(current); if (parent === current) return null; current = parent;
  }
}

const DISCOVERY_SKIP = new Set(['.git', '.svn', 'node_modules', 'bower_components', 'vendor', '.pnpm', '.yarn', '.npm', '.cache', '__pycache__', '.venv', 'venv', '.tox', '.mypy_cache', '.pytest_cache', '.gradle', '.nuget']);

async function repositoryAt(directory, type, options = () => undefined) {
  if (type === 'svn') {
    const info = parseXML(await svn(directory, ['info', '--xml', '--', '.'], undefined, options())).info.entry[0];
    return { root: await fs.realpath(info['wc-info']['wcroot-abspath']), type };
  }
  const root = await fs.realpath((await git(directory, ['rev-parse', '--show-toplevel'], undefined, options())).toString('utf8').trim());
  let branch;
  try { branch = (await git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], undefined, options())).toString('utf8').trim(); }
  catch (e) {
    if (e.code !== 'VCS_COMMAND') throw e;
    branch = (await git(root, ['rev-parse', '--short', 'HEAD'], undefined, options())).toString('utf8').trim();
  }
  return { root, type, branch };
}

/**
 * Discover enclosing Git AND SVN working copies independently, then nested copies.
 * Depth zero scans only the selected directory. Directory limits apply to the
 * downward walk (not the short enclosing-ancestor walk). relativePath is relative
 * to the original cwd, including '..' for enclosing copies and '.' for cwd itself.
 * Cancellation/deadlines return partial results with truncated=true and warnings.
 * Invalid options/targets reject. Targeted scans never follow symlinks/junctions.
 */
export async function discoverRepositories(cwd, { signal, maxDepth = 6, maxDirectories = 2000, maxRepositories = 100, timeoutMs = 10000, subdirectory, shallow = false } = {}) {
  for (const [name, value] of Object.entries({ maxDepth, maxDirectories, maxRepositories, timeoutMs })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid discovery option: ' + name);
  }
  const deadline = performance.now() + timeoutMs;
  const result = { repositories: [], truncated: false, warnings: [] };
  const warn = message => { result.truncated = true; if (!result.warnings.includes(message)) result.warnings.push(message); };
  const check = () => {
    if (signal?.aborted) throw Object.assign(new Error('Discovery cancelled'), { code: 'ABORT_ERR' });
    if (performance.now() >= deadline) throw Object.assign(new Error('Discovery timed out'), { code: 'TIMEOUT' });
  };
  const options = () => { check(); return { signal, timeoutMs: Math.max(1, Math.min(TIMEOUT, Math.ceil(deadline - performance.now()))) }; };
  if (subdirectory !== undefined && (typeof subdirectory !== 'string' || !subdirectory || subdirectory.includes('\0') || path.isAbsolute(subdirectory) || path.win32.isAbsolute(subdirectory) || /^[a-z]:/i.test(subdirectory) || subdirectory.split(/[\\/]/).some(p => p === '..' || p.includes(':')))) throw new Error('Invalid discovery subdirectory');
  // Validate the explicit target even when the request has already been cancelled.
  const base = await fs.realpath(cwd);
  if (!(await fs.stat(base)).isDirectory()) throw new Error('Discovery cwd must be a directory');
  let start = base;
  if (subdirectory !== undefined) {
    for (const part of subdirectory.split(/[\\/]/).filter(p => p && p !== '.')) {
      start = path.join(start, part);
      const stat = await fs.lstat(start);
      if (stat.isSymbolicLink()) throw new Error('Discovery subdirectory must not traverse a symlink or junction');
      if (!stat.isDirectory()) throw new Error('Discovery subdirectory must be a directory');
    }
    start = await fs.realpath(start);
    if (!inside(base, start)) throw new Error('Discovery subdirectory escapes cwd');
  }
  const unavailable = new Set(), seen = new Set(), inspected = new Map();
  let halted = false, directories = 0;
  const failure = (type, directory, e) => {
    if (['ABORT_ERR', 'TIMEOUT'].includes(e.code)) throw e;
    if (e.code === 'ENOENT' && e.syscall?.startsWith('spawn')) {
      unavailable.add(type); warn(type + ' executable is unavailable; repository discovery is incomplete.');
    } else warn('Cannot inspect ' + type + ' repository at ' + directory + ': ' + e.message);
  };
  const inspect = async (directory, type) => {
    check();
    const key = type + '\0' + directory;
    if (inspected.has(key)) return inspected.get(key);
    if (unavailable.has(type)) return false;
    let marker;
    try { marker = await fs.lstat(path.join(directory, '.' + type)); }
    catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') failure(type, directory, e); return false; }
    if (marker.isSymbolicLink() || !(marker.isDirectory() || (type === 'git' && marker.isFile()))) return false;
    try {
      const repo = await repositoryAt(directory, type, options);
      check();
      // Git metadata may name a different work tree. It is not a repository here.
      if (path.relative(directory, repo.root) !== '') { warn('Repository root differs from marker directory: ' + directory); return false; }
      const canonical = process.platform === 'win32' ? repo.root.toLowerCase() : repo.root;
      const identity = type + '\0' + canonical;
      if (!seen.has(identity)) {
        if (result.repositories.length >= maxRepositories) { warn('Repository limit reached (' + maxRepositories + ').'); halted = true; return true; }
        seen.add(identity);
        result.repositories.push({ id: createHash('sha256').update(identity).digest('hex'), ...repo, relativePath: path.relative(base, repo.root).split(path.sep).join('/') || '.' });
      }
      inspected.set(key, true);
      return true;
    } catch (e) { failure(type, directory, e); inspected.set(key, false); return false; }
  };
  // Streaming DFS bounds memory even for directories containing millions of files.
  const walk = async (directory, depth) => {
    check();
    if (halted) return;
    if (directories >= maxDirectories) { warn('Directory limit reached (' + maxDirectories + ').'); halted = true; return; }
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return;
    const real = await fs.realpath(directory);
    if (!inside(start, real)) { warn('Directory escaped scan root: ' + directory); return; }
    directories++;
    for (const type of ['git', 'svn']) { await inspect(directory, type); if (halted) return; }
    if (shallow && depth >= 1) return; // Do not even enumerate grandchildren.
    const handle = await fs.opendir(directory);
    for await (const entry of handle) {
      check();
      if (halted) break;
      if (DISCOVERY_SKIP.has(entry.name.toLowerCase()) || entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const child = path.join(directory, entry.name);
      if ((await fs.lstat(child)).isSymbolicLink()) continue;
      if (depth >= maxDepth) { warn('Depth limit reached (' + maxDepth + ').'); continue; }
      try { await walk(child, depth + 1); }
      catch (e) { if (['ABORT_ERR', 'TIMEOUT'].includes(e.code)) throw e; warn('Cannot scan directory ' + child + ': ' + e.message); }
    }
  };
  try {
    check();
    // Probe tools even for empty folders: absent tools must not look like a clean scan.
    for (const type of ['git', 'svn']) {
      try { await (type === 'git' ? git : svn)(start, ['--version'], undefined, options()); }
      catch (e) { failure(type, start, e); unavailable.add(type); }
    }
    const found = new Set(unavailable);
    for (let current = start; found.size < 2 && !halted; current = path.dirname(current)) {
      check();
      for (const type of ['git', 'svn']) {
        if (!found.has(type) && await inspect(current, type)) found.add(type);
        if (halted) break;
      }
      if (path.dirname(current) === current) break;
    }
    if (!halted) await walk(start, 0);
    check();
  } catch (e) { warn(['ABORT_ERR', 'TIMEOUT'].includes(e.code) ? e.message : 'Discovery incomplete: ' + e.message); }
  return result;
}

async function checkedRepo(repo, signal) {
  signal?.throwIfAborted();
  if (!repo || !['git', 'svn'].includes(repo.type) || typeof repo.root !== 'string') throw new Error('Invalid repository');
  const found = await repositoryAt(repo.root, repo.type, () => ({signal}));
  signal?.throwIfAborted();
  if (!found || found.type !== repo.type || path.resolve(found.root) !== path.resolve(repo.root)) throw new Error('Repository root changed or is invalid');
  return found;
}
export async function listHistory(repo, {snapshot,offset=0,limit=50,signal} = {}) {
  if(!Number.isInteger(offset)||offset<0||offset>10000||!Number.isInteger(limit)||limit<1||limit>100) throw new Error('Invalid history pagination');
  if(snapshot!==undefined && (typeof snapshot!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(snapshot))) throw new Error('Invalid history snapshot');
  if(signal?.aborted) throw Object.assign(new Error('History cancelled'),{code:'ABORT_ERR'});
  repo=await checkedRepo(repo,signal);
  if(repo.type!=='git') throw new Error('History currently supports Git only');
  if(!snapshot){
    try{snapshot=(await git(repo.root,['rev-parse','--verify','HEAD^{commit}'],MAX_TEXT,{signal})).toString('utf8').trim();}
    catch(e){
      if(e.code!=='VCS_COMMAND')throw e;
      // Distinguish an unborn symbolic HEAD from corruption or other command failures.
      const ref=(await git(repo.root,['symbolic-ref','-q','HEAD'],MAX_TEXT,{signal})).toString('utf8').trim();
      try{await git(repo.root,['show-ref','--verify','--quiet',ref],MAX_TEXT,{signal});}
      catch(missing){if(missing.code==='VCS_COMMAND'&&missing.exitCode===1)return {snapshot:null,commits:[],nextOffset:null};throw missing;}
      throw e;
    }
  }
  const text=await git(repo.root,['log','-z','--no-show-signature','--encoding=UTF-8','--topo-order','--max-count='+String(limit+1),'--skip='+String(offset),'--format='+HISTORY_FORMAT,snapshot,'--'],MAX_TEXT,{signal});
  const rows=parseHistory(text.toString('utf8'),limit+1);
  return historyPage(rows,snapshot,offset,limit);
}
export async function getCommitDetails(repo,{commit,parentIndex=0,signal}={}) {
  if(typeof commit!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit))throw new Error('Invalid commit id');
  if(!Number.isInteger(parentIndex)||parentIndex<0)throw new Error('Invalid parent index');
  signal?.throwIfAborted();
  repo=await checkedRepo(repo,signal);
  if(repo.type!=='git')throw new Error('Commit details support Git only');
  const raw=await git(repo.root,['log','-z','--no-show-signature','--encoding=UTF-8','--max-count=1','--format='+HISTORY_FORMAT,commit,'--'],MAX_TEXT,{signal});
  const metadata=parseHistory(raw.toString('utf8'),1)[0];
  if(!metadata||metadata.id!==commit)throw new Error('Commit object required');
  if(parentIndex>=Math.max(1,metadata.parents.length))throw new Error('Invalid parent index');
  const parent=metadata.parents[parentIndex]??null;
  const args=['diff-tree','--no-commit-id','--name-status','-z','-r','--no-ext-diff','--no-textconv','--find-renames',...(parent?[parent,commit]:['--root',commit]),'--'];
  const fields=(await git(repo.root,args,MAX_TEXT,{signal})).toString('utf8').split(String.fromCharCode(0));
  if(fields.pop()!=='')throw new Error('Truncated commit changes');
  const changes=[];
  for(let i=0;i<fields.length;){
    const code=fields[i++];
    if(!/^(?:[AMDT]|[RC][0-9]{1,3})$/.test(code))throw new Error('Invalid commit change status');
    const first=fields[i++],renamed=/^[RC]/.test(code),file=renamed?fields[i++]:first;
    if(!first||!file)throw new Error('Truncated commit path');
    const entry={path:file,...(renamed?{oldPath:first}:{}),status:statuses[code[0]]||'modified'};
    changes.push({...entry,id:identity(entry,commit+':'+(parent||'root'))});
    if(changes.length>10000)throw new Error('Commit exceeds file count limit');
  }
  return {...metadata,parent,parentIndex,changes};
}
function modeFor(repo, mode) {
  if (!['all', 'staged', 'unstaged'].includes(mode)) throw new Error('Invalid comparison mode');
  if (repo.type === 'svn' && mode !== 'all') throw new Error('SVN supports only all mode');
}
function identity(entry, mode) { return createHash('sha256').update(JSON.stringify([mode, entry.path, entry.oldPath, entry.status, entry.indexStatus, entry.worktreeStatus, entry.propertyStatus])).digest('hex'); }
const statuses = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflicted', T: 'typechanged', '?': 'untracked' };
async function changes(repo, mode) {
  let entries;
  if (repo.type === 'git') {
    const fields = (await git(repo.root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'])).toString('utf8').split('\0');
    entries = [];
    for (let i = 0; i < fields.length && fields[i]; i++) {
      const raw = fields[i], x = raw[0], y = raw[1], file = raw.slice(3);
      const oldPath = /[RC]/.test(x + y) ? fields[++i] : undefined;
      const conflict = x === 'U' || y === 'U' || ['AA', 'DD'].includes(x + y);
      if (mode === 'staged' && (x === ' ' || x === '?')) continue;
      if (mode === 'unstaged' && (y === ' ' || y === '!')) continue;
      const code = mode === 'staged' ? x : mode === 'unstaged' ? y : (y !== ' ' && y !== '?' ? y : x);
      entries.push({ path: file, ...(oldPath ? { oldPath } : {}), status: conflict ? 'conflicted' : statuses[code] || 'modified', indexStatus: x, worktreeStatus: y });
    }
  } else {
    const document = parseXML(await svn(repo.root, ['status', '--xml', '--ignore-externals', '--', '.']));
    entries = [];
    for (const target of document.status?.target || []) for (const item of target.entry || []) {
      const state = item['wc-status'];
      if (['ignored', 'external', 'none'].includes(state.item) && !['modified', 'conflicted'].includes(state.props)) continue;
      if (state.item === 'normal' && !['modified', 'conflicted'].includes(state.props) && state['tree-conflicted'] !== 'true') continue;
      const file = (path.isAbsolute(item.path) ? path.relative(repo.root, item.path) : item.path).split(path.sep).join('/');
      entries.push({ path: file, status: state['tree-conflicted'] === 'true' || state.props === 'conflicted' ? 'conflicted' : state.item === 'normal' ? 'modified' : state.item, propertyStatus: state.props, treeConflict: state['tree-conflicted'] === 'true' });
    }
  }
  return entries.map(entry => ({ ...entry, id: identity(entry, mode) }));
}
/** Changes have opaque IDs, status words, and repo-relative paths. */
export async function listChanges(repo, mode = 'all') { repo = await checkedRepo(repo); modeFor(repo, mode); return changes(repo, mode); }
export function decode(buffer) {
  if (buffer.length > MAX_TEXT) return { text: '', notice: 'File exceeds the 2 MiB preview limit.' };
  let text, encoding = 'UTF-8';
  if (buffer[0] === 0xff && buffer[1] === 0xfe) { if (buffer.length % 2) return { text: '', binary: true, notice: 'Invalid UTF-16 file.' }; text = buffer.subarray(2).toString('utf16le'); encoding = 'UTF-16LE'; }
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) { const b = Buffer.from(buffer.subarray(2)); if (b.length % 2) return { text: '', binary: true, notice: 'Invalid UTF-16 file.' }; b.swap16(); text = b.toString('utf16le'); encoding = 'UTF-16BE'; }
  else {
    if (buffer.includes(0)) return { text: '', binary: true, notice: 'Binary file; text preview unavailable.' };
    if (buffer.some(byte => byte < 32 && ![9,10,12,13].includes(byte))) return { text: '', binary: true, notice: 'Binary control bytes; text preview unavailable.' };
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch {
      // A UTF-8 BOM is authoritative; do not reinterpret malformed UTF-8 as GBK.
      if (buffer.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf]))) return {text:'',binary:true,notice:'Invalid UTF-8 file.'};
      try { text = new TextDecoder('gbk', {fatal:true}).decode(buffer); encoding = 'GBK'; }
      catch { return {text:'',binary:true,notice:'Unsupported encoding or binary file; preview unavailable.'}; }
    }
  }
  return { text, encoding };
}
async function content(fn) { try { return decode(await fn()); } catch (e) { if (e.code === 'TOO_LARGE') return { text: '', notice: 'File exceeds the 2 MiB preview limit.' }; throw e; } }
async function working(root, relative, svnLink = false) {
  const target = await confined(root, relative);
  let stat; try { stat = await fs.lstat(target); } catch (e) { if (e.code === 'ENOENT') return { text: '' }; throw e; }
  if (stat.isSymbolicLink()) return { text: (svnLink ? 'link ' : '') + await fs.readlink(target) };
  if (!stat.isFile()) return { text: '', notice: 'Directory or special file; no file-content preview.' };
  if (stat.size > MAX_TEXT) return { text: '', notice: 'File exceeds the 2 MiB preview limit.' };
  const handle = await fs.open(target, 'r');
  try { const info = await handle.stat(); if (!info.isFile()) throw new Error('Not a regular file'); const buffer = Buffer.alloc(MAX_TEXT + 1); const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0); await confined(root, relative); return decode(buffer.subarray(0, bytesRead)); } finally { await handle.close(); }
}
async function gitBlob(root, revision, file) { return content(() => git(root, ['show', '--no-ext-diff', '--no-textconv', revision + ':' + file], MAX_TEXT)); }
async function historicalBlob(root,revision,file,signal){
  const listing=(await git(root,['ls-tree','-z',revision,'--',file],MAX_TEXT,{signal})).toString('utf8');
  const records=listing.split(String.fromCharCode(0)).filter(Boolean);
  const record=records.find(row=>row.slice(row.indexOf('	')+1)===file);
  if(!record)throw new Error('Historical path missing');
  const [mode,type,oid]=record.slice(0,record.indexOf('	')).split(' ');
  if(mode==='160000')return {text:oid,notice:'Submodule commit reference; repository contents are not loaded.'};
  if(type!=='blob'||!['100644','100755','120000'].includes(mode))return {text:'',notice:'Unsupported historical object type.'};
  const result=await content(()=>git(root,['cat-file','blob',oid],MAX_TEXT,{signal}));
  if(mode==='120000')result.notice=[result.notice,'Symbolic link target text; not followed.'].filter(Boolean).join(' ');
  return result;
}
export async function getCommitComparison(repo,{commit,parentIndex=0,id,signal}={}){
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new Error('Invalid historical change id');
  const details=await getCommitDetails(repo,{commit,parentIndex,signal});
  const entry=details.changes.find(row=>row.id===id);
  if(!entry)throw new Error('Historical change is not part of selected commit and parent');
  const left=details.parent&&entry.status!=='added'?await historicalBlob(repo.root,details.parent,entry.oldPath||entry.path,signal):{text:''};
  const right=entry.status!=='deleted'?await historicalBlob(repo.root,commit,entry.path,signal):{text:''};
  return {...entry,left:{...left,label:details.parent||'Empty tree'},right:{...right,label:commit},binary:!!(left.binary||right.binary),notice:[left.notice,right.notice].filter(Boolean).join(' ')};
}
async function properties(root, file, base) {
  const result = parseXML(await svn(root, ['proplist', '--xml', '--verbose', ...(base ? ['--revision', 'BASE'] : []), '--', file + '@']));
  const props = Object.create(null);
  for (const target of result.properties?.target || []) for (const prop of target.property || []) props[prop.name] = prop.encoding === 'base64' ? '[base64] ' + (prop['#text'] || '') : String(prop['#text'] ?? '');
  return props;
}
/** Revalidates the opaque ID against fresh status before reading any selected path. */
export async function getComparison(repo, { mode = 'all', id } = {}) {
  repo = await checkedRepo(repo); modeFor(repo, mode);
  const entry = (await changes(repo, mode)).find(item => item.id === id);
  if (!entry) throw new Error('Change no longer exists; refresh repository status.');
  await confined(repo.root, entry.path); if (entry.oldPath) await confined(repo.root, entry.oldPath);
  let left = { text: '' }, right = { text: '' }, leftLabel, rightLabel, props, notice;
  if (repo.type === 'git') {
    leftLabel = mode === 'unstaged' ? 'Index' : 'HEAD'; rightLabel = mode === 'staged' ? 'Index' : 'Working tree';
    if (entry.status === 'conflicted') {
      notice = 'Unmerged conflict: showing HEAD versus working tree (index has conflict stages).'; leftLabel = 'HEAD'; rightLabel = 'Working tree';
      try { left = await gitBlob(repo.root, 'HEAD', entry.oldPath || entry.path); } catch (e) { if (e.code !== 'VCS_COMMAND') throw e; }
      right = await working(repo.root, entry.path);
    } else {
      let hasHead = true; try { await git(repo.root, ['rev-parse', '--verify', 'HEAD']); } catch (e) { if (e.code !== 'VCS_COMMAND') throw e; hasHead = false; }
      const untracked = entry.indexStatus === '?';
      const addedToHead = entry.indexStatus === 'A' || entry.indexStatus === 'C';
      if (!untracked && (mode === 'unstaged' ? entry.indexStatus !== 'D' : (hasHead && !addedToHead))) left = await gitBlob(repo.root, mode === 'unstaged' ? '' : 'HEAD', mode === 'unstaged' ? entry.path : entry.oldPath || entry.path);
      if (mode === 'staged') { if (entry.indexStatus !== 'D') right = await gitBlob(repo.root, '', entry.path); }
      else right = await working(repo.root, entry.path);
    }
  } else {
    leftLabel = 'BASE'; rightLabel = 'Working copy';
    const added = ['added', 'unversioned', 'replaced'].includes(entry.status);
    if (entry.status === 'replaced') notice = 'Replaced node: local SVN BASE is unavailable; showing empty versus working content without contacting the server.';
    let directory = false;
    try { directory = (await fs.lstat(await confined(repo.root, entry.path))).isDirectory(); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!added && !directory) {
      const info = parseXML(await svn(repo.root, ['info', '--xml', '--', entry.path + '@'])).info.entry[0]; directory = info.kind === 'dir';
      if (!directory) left = await content(() => svn(repo.root, ['cat', '--revision', 'BASE', '--', entry.path + '@'], MAX_TEXT));
    }
    if (directory) notice = 'Directory change; property differences are shown separately.';
    else right = await working(repo.root, entry.path, true);
    if (entry.status !== 'unversioned') props = { left: added ? {} : await properties(repo.root, entry.path, true), right: ['deleted', 'missing'].includes(entry.status) ? {} : await properties(repo.root, entry.path, false) };
    if (entry.status === 'conflicted') notice = 'Conflicted working copy: showing BASE versus working content.';
  }
  return { ...entry, left: { label: leftLabel, text: left.text, encoding: left.encoding }, right: { label: rightLabel, text: right.text, encoding: right.encoding }, ...(left.binary || right.binary ? { binary: true } : {}), ...([notice, left.notice, right.notice].filter(Boolean).length ? { notice: [...new Set([notice, left.notice, right.notice].filter(Boolean))].join(' ') } : {}), ...(props ? { properties: props } : {}) };
}
