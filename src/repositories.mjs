// Pure repository presentation/request helpers, independent of React and the host.
export function selectProject(repositories, previousId = '') {
 return repositories.find(repo=>repo.id===previousId)?.id
   || repositories.find(repo=>repo.relativePath==='.')?.id
   || repositories[0]?.id || '';
}
export const changeKey = (repositoryId, changeId) => JSON.stringify([repositoryId, changeId]);
export const repositoryLabel = (repository, workspaceLabel = '.') => [repository.type.toUpperCase(), repository.relativePath === '.' ? workspaceLabel : repository.relativePath || '.', repository.branch].filter(Boolean).join(' · ');
export const requestMode = (repository, mode = 'all') => repository.type === 'git' && ['staged', 'unstaged'].includes(mode) ? mode : 'all';
export function groupChanges(repositories, statuses, query = '') {
  const needle = query.toLowerCase();
  return repositories.map(repository => ({
    ...statuses[repository.id],
    repository,
    changes: (statuses[repository.id]?.changes || []).filter(change => change.path.toLowerCase().includes(needle)).sort((a, b) => a.path.localeCompare(b.path)),
  }));
}
// A targeted scan supplements discovery; a full scan replaces it.
export function mergeDiscovery(previous, next, subdirectory = '') {
  if (!subdirectory || !previous || previous.cwd !== next.cwd) return next;
  const repositories = new Map(previous.repositories.map(repository => [repository.id, repository]));
  for (const repository of next.repositories) repositories.set(repository.id, repository);
  return {...next, repositories: [...repositories.values()], truncated: previous.truncated || next.truncated, warnings: [...(previous.warnings || []), ...(next.warnings || [])]};
}
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
