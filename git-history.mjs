// Format for: git log -z --format=<HISTORY_FORMAT>. NUL separates fields/records.
export const HISTORY_FORMAT = '%H%x00%P%x00%an%x00%aI%x00%s';
const oid = value => /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
export function historyPage(rows,snapshot,offset,limit){
 const hasMore=rows.length>limit;
 const truncated=hasMore&&offset+limit>10000;
 return {snapshot,commits:rows.slice(0,limit),nextOffset:hasMore&&!truncated?offset+limit:null,truncated};
}
export function parseHistory(text, maxRecords = 101) {
  if(typeof text !== 'string' || Buffer.byteLength(text,'utf8') > 2*1024*1024) throw new Error('History output exceeds limit or is invalid');
  if(!Number.isInteger(maxRecords)||maxRecords<1||maxRecords>101) throw new Error('Invalid history record limit');
  if(!text) return [];
  if(!text.endsWith('\0')) throw new Error('Truncated history output');
  const fields=text.slice(0,-1).split('\0');
  if(fields.length%5 || fields.length/5>maxRecords) throw new Error('Invalid history field count or record limit');
  const result=[];
  for(let i=0;i<fields.length;i+=5){
    const [id,parentText,author,date,subject]=fields.slice(i,i+5);
    const parents=parentText?parentText.split(' '):[];
    if(!oid(id)||parents.some(p=>!oid(p)||p.length!==id.length)) throw new Error('Invalid history object id');
    if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(date)||!Number.isFinite(Date.parse(date))) throw new Error('Invalid history timestamp');
    result.push({id,parents,author,date,subject});
  }
  return result;
}
