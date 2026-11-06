// NUL field and record delimiters: Git -z supplies the final record delimiter.
export const REFLOG_FORMAT = '%H%x00%gD%x00%gs';
export const REFLOG_MAX_OUTPUT = 2 * 1024 * 1024;
const LIMIT = 200;
const invalid = () => new Error('Invalid HEAD reflog framing or metadata.');
function validDate(date) {
 if (!Number.isFinite(Date.parse(date))) return false;
 // Date.parse normalizes dates such as February 30; reject those too.
 const calendar=date.slice(0,19);
 if (new Date(calendar+'Z').toISOString().slice(0,19)!==calendar) return false;
 if (date.endsWith('Z')) return true;
 return Number(date.slice(-5,-3))<=23 && Number(date.slice(-2))<=59;
}

/** Strictly parse the entire bounded lookahead, including its last (hidden) entry. */
export function parseReflog(raw) {
 if (!Buffer.isBuffer(raw) || raw.length > REFLOG_MAX_OUTPUT) throw invalid();
 let text;
 try { text = new TextDecoder('utf-8', {fatal:true}).decode(raw); } catch { throw invalid(); }
 if (!text) return {entries:[],truncated:false};
 if (!text.endsWith('\0')) throw invalid();
 const fields = text.slice(0,-1).split('\0');
 if (fields.length % 3 || fields.length / 3 > LIMIT + 1) throw invalid();
 const entries=[];
 for (let i=0;i<fields.length;i+=3) {
  const [id,selector,message]=fields.slice(i,i+3);
  const match=/^HEAD@\{(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2}))\}$/.exec(selector);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(id) || !match || !validDate(match[1]) || /[\r\n]/.test(message)) throw invalid();
  // The date is the reflog event timestamp, not the commit author/committer date.
  entries.push({id,selector,message,date:match[1]});
 }
 return {entries:entries.slice(0,LIMIT),truncated:entries.length>LIMIT};
}
