import {spawn} from 'node:child_process';

const MAX_OUTPUT = 16 * 1024 * 1024;
export const TIMEOUT = 15000;

// Local adapter primitive, not the remote SVN transport. Preserve its error contract.
export function run(command, args, cwd, max = MAX_OUTPUT, { signal, timeoutMs = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Object.assign(new Error('Discovery cancelled'), { code: 'ABORT_ERR' })); return; }
    // Inherited Git overrides must not redirect reads to a different repository.
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_')));
    Object.assign(env, { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '', LC_ALL: process.platform === 'linux' ? 'C.UTF-8' : 'en_US.UTF-8' });
    const child = spawn(command, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    const out = [], err = [];
    let size = 0, error, done = false;
    const stop = failure => {
      error ??= failure;
      child.kill();
    };
    const abort = () => stop(Object.assign(new Error('Discovery cancelled'), { code: 'ABORT_ERR' }));
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop(Object.assign(new Error(command + ' timed out'), { code: 'TIMEOUT' })), timeoutMs);
    // Both streams consume the same budget; never expose partial success.
    const collect = chunks => bytes => {
      size += bytes.length;
      if (size > max) {
        stop(Object.assign(new Error('Output exceeds size limit'), {code: 'TOO_LARGE'}));
      } else {
        chunks.push(bytes);
      }
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    const finish = failure => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else resolve(Buffer.concat(out));
    };
    child.on('error', finish);
    child.on('close', code => finish(error || (code !== 0 ? Object.assign(new Error(command + ': ' + Buffer.concat(err).toString('utf8').trim()), { code: 'VCS_COMMAND', exitCode: code }) : null)));
  });
}
export const git = (root, args, max, options) => run('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...args], root, max, options);
export const svn = (root, args, max, options) => run('svn', ['--non-interactive', ...args], root, max, options);
