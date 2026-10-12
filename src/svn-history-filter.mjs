// Bounded display filter over an already-loaded SVN history window.
// SVN DAV REPORT supports revision ranges only, not date ranges, so this is an
// in-window filter (never claims cross-window completeness) and never issues requests.
export function filterSvnHistory(entries, {since, until} = {}) {
  const bound = value => {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new Error('Invalid SVN history date bound.');
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d{4}-\d{2}-\d{2}(?:T\S{0,40})?$/.test(trimmed)) throw new Error('Invalid SVN history date bound.');
    return trimmed.slice(0, 10);
  };
  const after = bound(since), before = bound(until);
  if (!after && !before) return entries;
  if (!Array.isArray(entries)) return [];
  return entries.filter(entry => {
    const raw = entry && typeof entry.date === 'string' ? entry.date.trim() : '';
    const day = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
    if (!day) return false;
    if (after && day < after) return false;
    if (before && day > before) return false;
    return true;
  });
}
