import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {git} from './local-command.mjs';
import {currentOperationBudget} from './src/operation-budget.mjs';
import {isObjectId} from './git-history.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_BRANCHES = 1000;
const LF = String.fromCharCode(10), NUL = String.fromCharCode(0);
const fail = (kind,message) => Object.assign(new Error(message),{code:'vcs/branch-'+kind});
const check = signal => {signal?.throwIfAborted();currentOperationBudget()?.throwIfExpired();};
const digest = value => createHash('sha256').update(value).digest('hex');
const branchName = value => {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.startsWith('-') || value.startsWith('refs/') || [...value].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127)) throw fail('unsupported','Select an existing local branch name.');
  return value;
};

// Private, empty hooks/attributes locations are command-scoped, never repository config writes.
async function safeContext(repo,signal,work) {
  check(signal);
  if (!repo || repo.type !== 'git' || typeof repo.root !== 'string') throw fail('unsupported','Branch switching supports local Git working copies only.');
  const root = await fs.realpath(repo.root);
  if (root !== path.resolve(repo.root)) throw fail('changed','Repository canonical root changed; rediscover repositories.');
  const metadata = path.join(root,'.git');
  const metadataStat = await fs.lstat(metadata);
  if (!metadataStat.isDirectory() || metadataStat.isSymbolicLink() || await fs.realpath(metadata) !== metadata) throw fail('unsupported','Linked, separate or symlinked Git directories are not supported.');
  const metadataIdentity = await checkedMetadata(metadata,signal);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'dsh-vcs-switch-'));
  try {
    const hooks = path.join(temporary,'hooks'),attributes = path.join(temporary,'attributes');
    await fs.mkdir(hooks);await fs.writeFile(attributes,'');
    const run = (args,max = MAX_BYTES) => {check(signal);return git(root,['-c','core.hooksPath='+hooks,'-c','core.attributesFile='+attributes,'-c','submodule.recurse=false','-c','core.ignoreStat=false','-c','core.untrackedCache=false','-c','core.protectNTFS=true','-c','core.protectHFS=true','-c','hook.post-checkout.enabled=false','-c','hook.reference-transaction.enabled=false',...args],max,{signal});};
    const top = (await run(['rev-parse','--show-toplevel'])).toString('utf8').trim();
    if (await fs.realpath(top) !== root || (await run(['rev-parse','--is-bare-repository'])).toString('utf8').trim() !== 'false') throw fail('unsupported','A canonical non-bare working copy is required.');
    return await work({root,run,metadataIdentity});
  } finally {await fs.rm(temporary,{recursive:true,force:true,maxRetries:5});}
}

// Metadata may redirect Git writes even when the .git root itself is canonical.
async function checkedMetadata(directory,signal) {
  const rows = [];let count = 0;
  const visit = async (target,recursive) => {
    check(signal);if (++count > 20000) throw fail('unsupported','Git metadata exceeds the safe inspection limit.');
    let stat;try {stat = await fs.lstat(target,{bigint:true});} catch (error) {if (error.code === 'ENOENT') return;throw error;}
    if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1n) || await fs.realpath(target) !== target || (!stat.isDirectory() && !stat.isFile())) throw fail('unsupported','Redirected Git metadata is not supported.');
    rows.push([path.relative(directory,target),String(stat.dev),String(stat.ino)]);
    if (recursive && stat.isDirectory()) {for (const entry of (await fs.readdir(target)).sort()) await visit(path.join(target,entry),true);}
  };
  await visit(directory,false);
  for (const file of ['HEAD','index','config','config.worktree','packed-refs','shallow']) await visit(path.join(directory,file),false);
  for (const name of ['objects','refs','logs','info']) await visit(path.join(directory,name),true);
  for (const file of ['objects/info/alternates','objects/info/http-alternates']) {
    try {await fs.lstat(path.join(directory,file));} catch (error) {if (error.code === 'ENOENT') continue;throw error;}
    throw fail('unsupported','Alternate object databases are not supported.');
  }
  return digest(JSON.stringify(rows));
}

function decode(buffer) {
  try {return new TextDecoder('utf-8',{fatal:true}).decode(buffer);}
  catch {throw fail('unsupported','Branch metadata must be valid UTF-8.');}
}
async function currentBranch(run) {
  let ref;
  try {ref = decode(await run(['symbolic-ref','--quiet','HEAD'])).trim();}
  catch (error) {if (error.code !== 'VCS_COMMAND') throw error;throw fail('unsupported','Detached or unborn HEAD cannot switch branches here.');}
  if (!ref.startsWith('refs/heads/')) throw fail('unsupported','HEAD must identify an existing local branch.');
  let commit;
  try {commit = decode(await run(['rev-parse','--verify',ref+'^{commit}'])).trim();}
  catch (error) {if (error.code !== 'VCS_COMMAND') throw error;throw fail('unsupported','Unborn HEAD cannot switch branches here.');}
  if (!isObjectId(commit)) throw fail('unsupported','Invalid current branch commit.');
  return {ref,name:ref.slice(11),commit};
}
async function branches(run) {
  const output = decode(await run(['for-each-ref','--sort=refname','--count='+String(MAX_BRANCHES+1),'--format=%(refname)%00%(objectname)%00%(objecttype)','refs/heads/']));
  const lines = output ? output.trimEnd().split(LF) : [];
  if (lines.length > MAX_BRANCHES) throw fail('unsupported','Local branch count exceeds 1000.');
  return lines.map(line => {
    const [ref,commit,type,...extra] = line.split(NUL);
    if (extra.length || !ref?.startsWith('refs/heads/') || !isObjectId(commit) || type !== 'commit') throw fail('unsupported','Invalid local branch metadata.');
    return {ref,name:ref.slice(11),commit};
  });
}
async function configSnapshot(run) {
  const raw = decode(await run(['config','--null','--list']));
  const config = [];
  for (const record of raw.split(NUL).filter(Boolean)) {
    const cut = record.indexOf(LF),key = (cut < 0 ? record : record.slice(0,cut)).toLowerCase(),value = cut < 0 ? '' : record.slice(cut+1);
    if (['hook.post-checkout.enabled','hook.reference-transaction.enabled'].includes(key) && value === 'false') continue;
    if (key === 'core.worktree') throw fail('unsupported','Separate Git working directories are not supported.');
    if (key.startsWith('filter.') || key.startsWith('hook.')) throw fail('unsupported','Configured Git filters or command hooks are not supported for safe switching.');
    if ((['core.sparsecheckout','core.sparsecheckoutcone','index.sparse'].includes(key) && !['false','no','0'].includes(value.toLowerCase())) || key === 'extensions.partialclone' || /^remote[.].*[.]promisor$/.test(key)) throw fail('unsupported','Sparse or partial working copies are not supported for safe switching.');
    if (!['core.hookspath','core.attributesfile','core.fsmonitor','submodule.recurse'].includes(key)) config.push(record);
  }
  return digest(config.join(NUL));
}
async function absentGitState(root,run) {
  const locations = decode(await run(['rev-parse','--git-dir','--git-common-dir'])).trim().split(LF);
  if (locations.length !== 2) throw fail('unsupported','Invalid Git metadata directory.');
  const directories = [...new Set(await Promise.all(locations.map(value => fs.realpath(path.resolve(root,value)))))];
  if (directories.some(directory => directory !== path.join(root,'.git'))) throw fail('unsupported','External Git metadata is not supported.');
  for (const directory of directories) for (const name of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','REBASE_HEAD','BISECT_LOG','rebase-merge','rebase-apply','sequencer','index.lock','HEAD.lock','info/sparse-checkout','info/attributes']) {
    try {await fs.lstat(path.join(directory,name));}
    catch (error) {if (error.code === 'ENOENT') continue;throw error;}
    throw fail('unsupported','Repository operation, sparse state, attributes or lock is present: '+name);
  }
}
async function safeTree(run,commit) {
  const raw = decode(await run(['ls-tree','-r','-z','--full-tree',commit]));
  if (raw && !raw.endsWith(NUL)) throw fail('unsupported','Truncated tree metadata.');
  const paths = [];
  for (const row of raw.split(NUL).filter(Boolean)) {
    const tab = row.indexOf(String.fromCharCode(9)),header = row.slice(0,tab),file = row.slice(tab+1);
    if (tab < 0 || !file || !/^(100644|100755) blob [a-f0-9]{40,64}$/.test(header)) throw fail('unsupported','Symlinks, submodules or unsupported tree entries prevent safe switching.');
    paths.push(file);
    if (file.split('/').some(part => part.toLowerCase() === '.gitattributes')) throw fail('unsupported','Git attributes are not supported for safe switching.');
  }
  return {hash:digest(raw),paths};
}
async function checkWorkingPaths(root,paths) {
  const checked = new Set();
  for (const file of paths) {
    if (!file || path.isAbsolute(file) || (process.platform === 'win32' && (file.includes(':') || file.includes(String.fromCharCode(92)))) || file.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw fail('unsupported','Invalid tracked path.');
    let component = root;
    for (const part of file.split('/')) {
      component = path.join(component,part);
      if (checked.has(component)) continue;
      checked.add(component);
      try {const stat=await fs.lstat(component,{bigint:true});if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1n)) throw fail('unsupported','Working tree symlinks or hardlinks prevent safe switching.');}
      catch (error) {if (error.code !== 'ENOENT') throw error;}
    }
  }
}
async function snapshotFor({root,run,metadataIdentity},name,signal) {
  branchName(name);
  try {await run(['check-ref-format','--branch',name]);}
  catch (error) {if (error.code !== 'VCS_COMMAND') throw error;throw fail('unsupported','Invalid local branch name.');}
  const config = await configSnapshot(run);
  await absentGitState(root,run);
  const current = await currentBranch(run);
  const target = (await branches(run)).find(item => item.name === name);
  if (!target) throw fail('changed','The selected local branch no longer exists.');
  try {await run(['show-ref','--verify','--quiet','refs/tags/'+name]);throw fail('unsupported','A tag shares the selected branch name; ambiguous selections are not supported.');}
  catch (error) {if (!(error.code === 'VCS_COMMAND' && error.exitCode === 1)) throw error;}
  if (target.ref === current.ref) throw fail('unsupported','The selected branch is already checked out.');
  const trees = [await safeTree(run,current.commit),await safeTree(run,target.commit)];
  const staged = decode(await run(['ls-files','--stage','-z']));
  for (const row of staged.split(NUL).filter(Boolean)) if (!/^[0-9]{6} [a-f0-9]{40,64} 0	/.test(row)) throw fail('dirty','Unmerged Index entries prevent switching.');
  await checkWorkingPaths(root,trees.flatMap(tree => tree.paths));
  const flags = decode(await run(['ls-files','-v','-z']));
  if (flags.split(NUL).filter(Boolean).some(row => !row.startsWith('H '))) throw fail('unsupported','Assume-unchanged, skip-worktree or special Index flags prevent switching.');
  // Filters have already been excluded before status can inspect working content.
  const status = await run(['status','--porcelain=v1','-z','--untracked-files=all','--ignored=matching','--ignore-submodules=none']);
  if (status.length) throw fail('dirty','Working copy must be clean, including staged, untracked and ignored files.');
  const afterCurrent = await currentBranch(run);
  const afterTarget = decode(await run(['rev-parse','--verify',target.ref+'^{commit}'])).trim();
  if (JSON.stringify(current) !== JSON.stringify(afterCurrent) || target.commit !== afterTarget) throw fail('changed','Branch references changed during preview validation.');
  check(signal);
  const metadata = await fs.lstat(path.join(root,'.git'),{bigint:true});
  const repositoryIdentity = [metadata.dev,metadata.ino,metadata.birthtimeNs].map(String);
  const fingerprint = digest(JSON.stringify({current,target,config,trees,staged,flags,repositoryIdentity,metadataIdentity}));
  return {root,current,target,fingerprint};
}

export async function listLocalBranches(repo,{signal} = {}) {
  return safeContext(repo,signal,async({run}) => ({current:await currentBranch(run),branches:await branches(run)}));
}
export async function prepareLocalBranchSwitch(repo,{branch,signal} = {}) {
  return safeContext(repo,signal,context => snapshotFor(context,branch,signal));
}
export async function switchLocalBranch(repo,{snapshot,signal,assertAuthorized,onStart} = {}) {
  let started = false;
  try {
    if (!snapshot || snapshot.root !== repo?.root || typeof snapshot.fingerprint !== 'string' || typeof assertAuthorized !== 'function' || typeof onStart !== 'function') throw fail('changed','A current server-issued branch preview is required.');
    return await safeContext(repo,signal,async context => {
      const fresh = await snapshotFor(context,snapshot.target?.name,signal);
      if (JSON.stringify(fresh) !== JSON.stringify(snapshot)) throw fail('changed','Branch selection or repository state changed; prepare again.');
      // External Git commands do not share the Host lock. No cross-process atomicity is claimed.
      await assertAuthorized();check(signal);
      started = true;onStart();
      await context.run(['switch','--no-guess','--no-overwrite-ignore','--no-recurse-submodules','--',fresh.target.name]);
      check(signal);await assertAuthorized();check(signal);
      const current = await currentBranch(context.run);
      if (current.ref !== fresh.target.ref || current.commit !== fresh.target.commit) throw fail('changed','Branch changed while switching.');
      return {current};
    });
  } catch (error) {
    if (!started) throw error;
    throw Object.assign(fail('outcome-unknown','Branch switch may have changed the working copy. Refresh repository state before any further action.'),{outcomeUnknown:true,cause:error});
  }
}
