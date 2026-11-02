// Isolated fixture infrastructure. Never connects to a user's existing browser/profile.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const remaining = (deadline, limit) => Math.max(0, Math.min(limit, deadline - Date.now()));
export function within(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(label + ' timed out')), Math.max(0, timeoutMs));
    Promise.resolve(promise).then(value => {clearTimeout(timer); resolve(value);}, error => {clearTimeout(timer); reject(error);});
  });
}

export function observeChild(child) {
  let failure, closed = child.exitCode != null || child.signalCode != null;
  const listeners = new Set();
  const fail = error => {failure ||= error; for (const listener of listeners) listener(failure);};
  child.on('error', error => {if (!child.pid) closed = true; fail(error);});
  child.on('exit', (code, signal) => fail(Error('Browser exited (' + (signal || code) + ')')));
  child.on('close', () => {closed = true; fail(Error('Browser closed'));});
  return {
    get closed() {return closed;},
    check() {if (failure) throw failure; if (child.exitCode != null || child.signalCode != null) throw Error('Browser exited');},
    subscribe(listener) {listeners.add(listener); if (failure) listener(failure); return () => listeners.delete(listener);},
  };
}

export async function waitForDevTools(childState, profile, {deadline, read = readFile, fetchImpl = fetch} = {}) {
  while (Date.now() < deadline) {
    childState.check();
    let port;
    try {port = Number((await within(read(path.join(profile, 'DevToolsActivePort'), 'utf8'), remaining(deadline, 1000), 'DevTools port read')).split(String.fromCharCode(10))[0]);} catch (error) {if (Date.now() >= deadline) throw error;}
    if (Number.isInteger(port) && port > 0 && port <= 65535) {
      // The port comes only from our fresh profile, never a fixed port on another browser.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remaining(deadline, 2000));
      try {
        const response = await within(fetchImpl('http://127.0.0.1:' + port + '/json', {signal: controller.signal}), remaining(deadline, 2000), 'DevTools discovery');
        if (!response.ok) throw Object.assign(Error('DevTools discovery HTTP ' + response.status), {retryDiscovery:response.status >= 500});
        const pages = await within(response.json(), remaining(deadline, 2000), 'DevTools discovery body');
        childState.check();
        if (!Array.isArray(pages)) throw Error('Invalid DevTools page list');
        const page = pages.find(page => page.type === 'page');
        if (!page) throw Object.assign(Error('DevTools page target not ready'), {retryDiscovery:true});
        const url = new URL(page.webSocketDebuggerUrl);
        if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.port !== String(port) || !url.pathname.startsWith('/devtools/page/') || url.username || url.password) throw Error('Invalid isolated DevTools target');
        return url.href;
      } catch (error) {
        childState.check();
        if (!error.retryDiscovery && error.code !== 'ECONNREFUSED' && error.cause?.code !== 'ECONNREFUSED') throw error;
        if (Date.now() >= deadline) throw Error('Browser debugging did not start before deadline', {cause:error});
      } finally {clearTimeout(timer); controller.abort();}
    }
    await pause(remaining(deadline, 50));
  }
  throw Error('Browser debugging did not start before deadline');
}

export async function connectCdp(socket, {childState, deadline = Date.now() + 240000, commandTimeoutMs = 30000, connectTimeoutMs = 10000} = {}) {
  const pending = new Map(); let sequence = 0, failure;
  let opened, rejectOpen;
  const open = new Promise((resolve, reject) => {opened = resolve; rejectOpen = reject;});
  const fail = error => {
    failure ||= error; rejectOpen(failure);
    for (const task of [...pending.values()]) task.reject(failure);
  };
  socket.onopen = () => opened();
  socket.onerror = () => fail(Error('Browser debugging socket failed'));
  socket.onclose = () => fail(Error('Browser debugging connection closed'));
  socket.onmessage = event => {
    let message;
    try {message = JSON.parse(event.data);} catch {fail(Error('Invalid browser debugging response')); return;}
    const task = pending.get(message.id);
    if (task) message.error ? task.reject(Error(JSON.stringify(message.error))) : task.resolve(message.result);
  };
  const unsubscribe = childState?.subscribe(fail);
  try {await within(open, remaining(deadline, connectTimeoutMs), 'Browser debugging connection');}
  catch (error) {unsubscribe?.(); fail(error); socket.close(); throw error;}
  return {
    call(method, params = {}, {timeoutMs = commandTimeoutMs} = {}) {
      if (failure) return Promise.reject(failure);
      if (Date.now() >= deadline) return Promise.reject(Error('Browser fixture deadline exceeded'));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const finish = fn => value => {clearTimeout(timer); pending.delete(id); fn(value);};
        const timer = setTimeout(() => task.reject(Error('Browser debugging command timed out: ' + method)), remaining(deadline, timeoutMs));
        const task = {resolve: finish(resolve), reject: finish(reject)};
        pending.set(id, task);
        try {socket.send(JSON.stringify({id, method, params}));} catch (error) {task.reject(error);}
      });
    },
    close() {unsubscribe?.(); fail(Error('Browser fixture disposed')); socket.close();},
    get pendingCount() {return pending.size;},
  };
}

export async function stopBrowser(child, state, {timeoutMs = 5000} = {}) {
  if (!child || state.closed) return;
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], {stdio:'ignore', windowsHide:true});
    try {await within(new Promise((resolve, reject) => {killer.once('error', reject); killer.once('close', resolve);}), timeoutMs, 'Browser process-tree kill');}
    catch {killer.kill(); child.kill('SIGKILL');}
  } else child.kill('SIGKILL');
  // Observe close, not only exit. The observer was installed immediately after spawn.
  const deadline = Date.now() + timeoutMs;
  while (!state.closed && Date.now() < deadline) await pause(10);
  if (!state.closed) throw Error('Browser did not close after termination; preserving temporary profile');
}

// Stay in the invoking runner's group so an external timeout also reaches Chromium.
export const browserSpawnOptions = () => ({stdio:'ignore', windowsHide:true, detached:false});

export async function startBrowser(executable, {timeoutMs = 240000, commandTimeoutMs = 30000, args = []} = {}) {
  if (!executable) throw Error('Existing Chrome/Chromium executable required');
  const profile = await mkdtemp(path.join(tmpdir(), 'dsh-vcs-browser-'));
  let child, state, cdp;
  const close = async () => {
    cdp?.close();
    if (child) await stopBrowser(child, state);
    if (path.dirname(profile) !== tmpdir() || !path.basename(profile).startsWith('dsh-vcs-browser-')) throw Error('Unsafe browser profile cleanup path');
    await rm(profile, {recursive:true, force:true, maxRetries:5});
  };
  try {
    child = spawn(executable, ['--headless', '--no-sandbox', '--disable-gpu', '--no-first-run', ...args, '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], browserSpawnOptions());
    state = observeChild(child);
    const deadline = Date.now() + timeoutMs;
    const target = await waitForDevTools(state, profile, {deadline:Math.min(deadline, Date.now() + 15000)});
    cdp = await connectCdp(new WebSocket(target), {childState:state, deadline, commandTimeoutMs});
    return {call:cdp.call, close, navigate:async url => {
      await cdp.call('Page.navigate', {url});
      while (Date.now() < deadline) {
        const result = await cdp.call('Runtime.evaluate', {expression:'location.href === ' + JSON.stringify(url) + ' && document.readyState !== "loading"', returnByValue:true});
        if (result.result?.value === true) return;
        await pause(50);
      }
      throw Error('Browser navigation timed out');
    }};
  } catch (error) {await close(); throw error;}
}

export async function startFixtureServer({root = process.cwd(), port = 0} = {}) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://fixture.invalid').pathname;
      if (pathname === '/test-results/') {response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><title>Isolated SVN fixture</title>'); return;}
      if (!/^[/](?:dist[/](?:editor[.]js|editor[.]css|editor[.]worker[.]js)|test-results[/](?:[a-z0-9-]+[.](?:js|html)|vcs-assets[/](?:editor[.]js|editor[.]css|editor[.]worker[.]js)))$/.test(pathname)) {response.writeHead(404).end(); return;}
      const bytes = await readFile(path.join(root, pathname.slice(1)));
      response.writeHead(200, {'Content-Type':pathname.endsWith('.html') ? 'text/html; charset=utf-8' : pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control':'no-store'}).end(bytes);
    } catch {response.writeHead(404).end();}
  });
  try {await within(new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', resolve);}), 5000, 'Fixture server listen');}
  catch (error) {server.close(); throw error;}
  return {origin:'http://127.0.0.1:' + server.address().port, close:async () => {server.closeAllConnections(); await within(new Promise(resolve => server.close(resolve)), 5000, 'Fixture server close');}};
}
