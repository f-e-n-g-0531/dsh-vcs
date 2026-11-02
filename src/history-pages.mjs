/** Keep four 50-row pages; back navigation refetches a fixed-snapshot window. */
export function mergeFileHistoryWindow(previous, incoming, offset) {
  const append = offset > 0 && previous.nextOffset === offset && (previous.pageOffset ?? -1) < offset;
  const rows = append ? [...previous.commits, ...incoming.commits] : incoming.commits;
  const commits = rows.filter((row, index) => rows.findIndex(other => other.id === row.id) === index).slice(-200);
  return {...incoming, commits, pageOffset: offset, windowEnd: offset + incoming.commits.length, windowStart: Math.max(0, offset + incoming.commits.length - commits.length)};
}
export function previousHistoryOffset(offset) {
  return Math.max(0, offset - 50);
}
