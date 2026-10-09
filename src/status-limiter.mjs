// Shared across effect generations: aborted requests retain their slot until settled.
export function createStatusLimiter(limit = 2) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 2) throw new RangeError('Status concurrency must be 1 or 2');
  let active = 0;
  const queue = [];
  function drain() {
    while (active < limit && queue.length) {
      const task = queue.shift();
      task.signal?.removeEventListener('abort', task.abort);
      if (task.signal?.aborted) { task.reject(new Error('Aborted')); continue; }
      active++;
      Promise.resolve().then(() => {
        if (task.signal?.aborted) throw new Error('Aborted');
        return task.run();
      }).then(task.resolve, task.reject).finally(() => { active--; drain(); });
    }
  }
  return (run, signal) => new Promise((resolve, reject) => {
    const task = {run, signal, resolve, reject, abort: null};
    task.abort = () => {
      const index = queue.indexOf(task);
      if (index >= 0) { queue.splice(index, 1); reject(new Error('Aborted')); }
    };
    if (signal?.aborted) { reject(new Error('Aborted')); return; }
    signal?.addEventListener('abort', task.abort, {once: true});
    queue.push(task);
    drain();
  });
}
