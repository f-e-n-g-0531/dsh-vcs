/** Structured server capabilities are authoritative; notices support old hosts only. */
export function canLoadLarge(comparison) {
  if (comparison?.preview !== undefined) return comparison.preview?.canLoadLarge === true;
  return typeof comparison?.notice === 'string' && comparison.notice.includes('2 MiB');
}
export function isPinnedSnapshot(value) {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
}
