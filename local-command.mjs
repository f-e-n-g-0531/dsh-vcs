import {spawn} from 'node:child_process';
import path from 'node:path';
import {currentOperationBudget} from './src/operation-budget.mjs';

const MAX_OUTPUT = 16 * 1024 * 1024;
export const TIMEOUT = 15000;
const KILL_GRACE_MS = 100;

// Local adapter primitive, not the remote SVN transport. Preserve its error contract.
export function run(command, args, cwd, max = MAX_OUTPUT, {signal, timeoutMs = TIMEOUT} = {}) {
  return new Promise((resolve, reject) => {
    const budget = currentOperationBudget();
    if (signal?.aborted) { reject(Object.assign(new Error('Discovery cancelled'), {code: 'ABORT_ERR'})); return; }
    try {
      budget?.throwIfExpired();
      if (!Number.isInteger(max) || max < 1 || max > MAX_OUTPUT || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid local command bounds.');
      timeoutMs = Math.min(timeoutMs, TIMEOUT, budget?.remaining() ?? TIMEOUT);
    } catch (error) { reject(error); return; }
    // Inherited Git overrides must not redirect reads to a different repository.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
    Object.assign(env, {GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', LC_ALL: process.platform === 'linux' ? 'C.UTF-8' : 'en_US.UTF-8'});
    const child = spawn(command, args, {cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env});
    const out = [], err = [];
    let size = 0, error, done = false, closed = false, exitCode, stopping = false, cleanupDone = true, killTimer;
    const signals = [...new Set([signal, budget?.signal].filter(Boolean))];
    const finish = () => {
      if (done || !closed || !cleanupDone) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      for (const source of signals) source.removeEventListener('abort', abort);
      if (error) reject(error);
      else if (exitCode !== 0) reject(Object.assign(new Error(command + ': ' + Buffer.concat(err).toString('utf8').trim()), {code: 'VCS_COMMAND', exitCode}));
      else resolve(Buffer.concat(out));
    };
    const killGroup = strength => {
      try { process.kill(-child.pid, strength); } catch (failure) {
        if (failure.code !== 'ESRCH') { try { child.kill(strength); } catch {} }
      }
    };
    const stop = failure => {
      error ??= failure;
      if (stopping || !child.pid) return;
      stopping = true; cleanupDone = false;
      if (process.platform === 'win32') {
        // Kill the tree before its parent can disappear and orphan pipe-owning descendants.
        const executable = path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe');
        const killer = spawn(executable, ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, shell: false, stdio: 'ignore'});
        killer.on('error', () => { try { child.kill('SIGKILL'); } catch {} });
        const guard = setTimeout(() => { try { child.kill('SIGKILL'); killer.kill(); } catch {} }, 1000);
        killer.once('close', () => { clearTimeout(guard); cleanupDone = true; finish(); });
      } else {
        killGroup('SIGTERM');
        killTimer = setTimeout(() => { killGroup('SIGKILL'); cleanupDone = true; finish(); }, KILL_GRACE_MS);
      }
    };
    const abort = () => {
      const source = signals.find(value => value.aborted);
      const reason = source?.reason?.code === 'TIMEOUT' ? source.reason : Object.assign(new Error('Discovery cancelled'), {code: 'ABORT_ERR'});
      stop(reason);
    };
    const timer = setTimeout(() => stop(Object.assign(new Error(command + ' timed out'), {code: 'TIMEOUT'})), timeoutMs);
    // Both streams consume the same budget; never retain unbounded or partial output.
    const collect = chunks => bytes => {
      if (error) return;
      size += bytes.length;
      if (size > max) stop(Object.assign(new Error('Output exceeds size limit'), {code: 'TOO_LARGE'}));
      else chunks.push(bytes);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    child.on('error', failure => { error ??= failure; });
    child.once('close', code => { closed = true; exitCode = code; finish(); });
    for (const source of signals) source.addEventListener('abort', abort, {once: true});
    // Abort can race spawn/listener registration.
    if (signals.some(value => value.aborted)) abort();
  });
}
export const git = (root, args, max, options) => run('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args], root, max, options);
export const svn = (root, args, max, options) => run('svn', ['--non-interactive', ...args], root, max, options);
