export const SINGLE_WINDOW_LINES = 500;
export function validLine(value) { return Number.isSafeInteger(value) && value > 0; }

// Coordinates are authoritative only when supplied by the segment protocol.
export function segmentReadingLocation(data, line = null, targetRequest = false) {
  const located = validLine(data?.startLine) && validLine(data?.endLine) && data.endLine >= data.startLine;
  const text = typeof data?.text === 'string' ? data.text : '';
  // Only a server-confirmed EOF line in a nonempty file may turn empty text into a row.
  const emptyLine = located && text === '' && data.targetFound === true && data.startLine === data.endLine && data.startLine > 1 && Number.isSafeInteger(data.totalBytes) && data.totalBytes > 0 && data.offset === data.totalBytes && data.endOffset === data.totalBytes && !data.startsMidLine && !data.endsMidLine;
  const window = singleFileWindow(text, {line, startLine: located ? data.startLine : 1, emptyLine});
  const boundaryEmpty = data?.endOffset < data?.totalBytes && /(?:\r\n|\r|\n)$/.test(text) && line === window.baseLine + window.totalLines - 1;
  const target = located && window.targetFound && line <= data.endLine && !boundaryEmpty && (!targetRequest || data.targetFound === true) ? line : null;
  return {located, emptyLine, startLine: located ? data.startLine : 1, target, partial: Boolean(data?.startsMidLine || data?.endsMidLine || data?.lineTruncated)};
}

// Scan the supplied, already bounded text without allocating a full line array.
// CRLF is one boundary; a final newline retains its empty final line.
export function singleFileWindow(text = '', {line = null, startLine = 1, anchor = null, emptyLine = false} = {}) {
  const base = validLine(startLine) ? startLine : 1;
  const requested = validLine(line) ? line : null;
  const breaks = /\r\n|\n|\r/g;
  let total = text === '' && emptyLine !== true ? 0 : 1;
  while (breaks.exec(text)) total++;
  const targetFound = requested !== null && requested >= base && requested - base < total;
  const focus = validLine(anchor) ? anchor : targetFound ? requested : base;
  const first = Math.max(0, Math.min(Math.max(0, total - SINGLE_WINDOW_LINES), focus - base - Math.floor(SINGLE_WINDOW_LINES / 2)));
  const end = Math.min(total, first + SINGLE_WINDOW_LINES);
  const rows = [];
  let index = 0, from = 0, match;
  breaks.lastIndex = 0;
  const emit = to => { if (index >= first && index < end) rows.push({number: base + index, text: text.slice(from, to)}); index++; };
  while (index < end && (match = breaks.exec(text))) { emit(match.index); from = breaks.lastIndex; }
  if (index < end) emit(text.length);
  return {rows, startLine: rows[0]?.number ?? base, endLine: rows.at(-1)?.number ?? base, totalLines: total, baseLine: base, targetFound, truncated: rows.length < total};
}
