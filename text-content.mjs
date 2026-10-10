/** Pure bounded byte decoding shared by working and committed previews. */
export const MAX_TEXT = 2 * 1024 * 1024;
export const MAX_LARGE_TEXT = 8 * 1024 * 1024;

/** Explicit historical mode only: complete UTF-8, never a truncated Diff input. */
export function decodeLargeText(buffer, signal) {
  signal?.throwIfAborted();
  if (buffer.length > MAX_LARGE_TEXT) throw new Error('Large comparison exceeds 8 MiB per side.');
  if (buffer.some(byte => byte < 32 && ![9, 10, 12, 13].includes(byte))) {
    throw new Error('Large comparison requires UTF-8 text without binary control bytes.');
  }
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(buffer); }
  catch { throw new Error('Large comparison requires valid UTF-8 text.'); }
  let lines = 1, length = 0;
  for (let index = 0; index < text.length; index++) {
    if (index % 65536 === 0) signal?.throwIfAborted();
    if (text[index] === '\n' || text[index] === '\r') {
      if (text[index] === '\r' && text[index + 1] === '\n') index++;
      if (++lines > 100000) throw new Error('Large comparison exceeds 100000 lines per side.');
      length = 0;
    } else if (++length > 65536) throw new Error('Large comparison exceeds 65536 characters per line.');
  }
  signal?.throwIfAborted();
  return {text, encoding: 'UTF-8', totalBytes: buffer.length, lineCount: lines};
}

export function decode(buffer) {
  if (buffer.length > MAX_TEXT) {
    return {text: '', notice: 'File exceeds the 2 MiB preview limit.'};
  }
  let text, encoding = 'UTF-8';
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    if (buffer.length % 2) return {text: '', binary: true, notice: 'Invalid UTF-16 file.'};
    text = buffer.subarray(2).toString('utf16le');
    encoding = 'UTF-16LE';
  } else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const bytes = Buffer.from(buffer.subarray(2));
    if (bytes.length % 2) return {text: '', binary: true, notice: 'Invalid UTF-16 file.'};
    bytes.swap16();
    text = bytes.toString('utf16le');
    encoding = 'UTF-16BE';
  } else {
    if (buffer.includes(0)) {
      return {text: '', binary: true, notice: 'Binary file; text preview unavailable.'};
    }
    if (buffer.some(byte => byte < 32 && ![9, 10, 12, 13].includes(byte))) {
      return {text: '', binary: true, notice: 'Binary control bytes; text preview unavailable.'};
    }
    try {
      text = new TextDecoder('utf-8', {fatal: true}).decode(buffer);
    } catch {
      // A UTF-8 BOM is authoritative; malformed UTF-8 must not become GBK.
      if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
        return {text: '', binary: true, notice: 'Invalid UTF-8 file.'};
      }
      try {
        text = new TextDecoder('gbk', {fatal: true}).decode(buffer);
        encoding = 'GBK';
      } catch {
        return {text: '', binary: true, notice: 'Unsupported encoding or binary file; preview unavailable.'};
      }
    }
  }
  return {text, encoding};
}
