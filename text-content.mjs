/** Pure bounded byte decoding shared by working and committed previews. */
export const MAX_TEXT = 2 * 1024 * 1024;

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
