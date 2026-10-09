/** Merge one fixed-snapshot page without accumulating an unbounded UI list. */
export function mergeHistoryWindow(previous, incoming, offset) {
  const commits = offset
    ? [...previous.commits.filter(row => !incoming.commits.some(next => next.id === row.id)), ...incoming.commits]
    : incoming.commits;
  return {
    ...incoming,
    windowEnd: offset + incoming.commits.length,
    commits: commits.slice(-200),
  };
}
