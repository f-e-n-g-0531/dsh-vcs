export const MAX_LCS_CELLS = 200000;
export const MAX_DISPLAY_LINES = 2000;

// Retain a trailing empty line so a final newline remains visible in the diff.
function lines(text) {
  return text === '' ? [] : text.split(/\r\n|\n|\r/);
}

/** Read-only line alignment. Work is linear outside the strictly bounded LCS.
 * Rows contain nullable {number, text} left/right cells and a change kind.
 * At most MAX_DISPLAY_LINES aligned rows are retained, not a full hidden diff.
 */
export function alignLines(before = '', after = '') {
  const left = lines(before), right = lines(after);
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix &&
    left[left.length - suffix - 1] === right[right.length - suffix - 1]) suffix++;
  const leftEnd = left.length - suffix, rightEnd = right.length - suffix;
  const n = leftEnd - prefix, m = rightEnd - prefix;
  const cells = n && m ? (n + 1) * (m + 1) : 0;
  const approximate = cells > MAX_LCS_CELLS;
  const rows = [];
  let totalRows = 0;
  function emit(i, j) {
    totalRows++;
    if (rows.length >= MAX_DISPLAY_LINES) return;
    rows.push({
      left: i === null ? null : {number: i + 1, text: left[i]},
      right: j === null ? null : {number: j + 1, text: right[j]},
      kind: i === null ? 'insert' : j === null ? 'delete' : left[i] === right[j] ? 'equal' : 'replace',
    });
  }
  for (let i = 0; i < prefix; i++) emit(i, i);
  if (approximate || !n || !m) {
    for (let k = 0; k < Math.max(n, m); k++) emit(k < n ? prefix + k : null, k < m ? prefix + k : null);
  } else {
    // Include boundary cells in the allocation budget, not just interior cells.
    const width = m + 1;
    const dp = new Uint32Array(cells);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * width + j] = left[prefix + i] === right[prefix + j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && left[prefix + i] === right[prefix + j]) {
        emit(prefix + i++, prefix + j++);
      } else if (i < n && (j === m || dp[(i + 1) * width + j] >= dp[i * width + j + 1])) {
        emit(prefix + i++, null);
      } else {
        emit(null, prefix + j++);
      }
    }
  }
  for (let k = 0; k < suffix; k++) emit(leftEnd + k, rightEnd + k);
  return {
    rows, approximate, truncated: totalRows > rows.length,
    totalRows, omittedRows: totalRows - rows.length,
    leftLineCount: left.length, rightLineCount: right.length,
    lcsCells: approximate ? 0 : cells,
  };
}
