// Each line-porcelain record carries its own metadata; never interpret filename as an access path.
export function parseBlame(text,maxLines=500){
 if(typeof text!=='string'||Buffer.byteLength(text,'utf8')>2*1024*1024)throw new Error('Invalid blame output size');
 if(!Number.isInteger(maxLines)||maxLines<1||maxLines>500)throw new Error('Invalid blame line limit');
 if(!text)return [];
 if(!text.endsWith('\n'))throw new Error('Truncated blame output');
 const fields=text.slice(0,-1).split('\n'),rows=[];
 for(let i=0;i<fields.length;){
  const header=/^([a-f0-9]{40}|[a-f0-9]{64}) ([1-9][0-9]*) ([1-9][0-9]*)(?: ([1-9][0-9]*))?$/.exec(fields[i++]);
  if(!header)throw new Error('Invalid blame header');
  const originalLine=Number(header[2]),line=Number(header[3]);
  if(!Number.isSafeInteger(originalLine)||!Number.isSafeInteger(line)||(rows.length&&line!==rows.at(-1).line+1))throw new Error('Invalid blame line sequence');
  const metadata={};
  while(i<fields.length&&!fields[i].startsWith('	')){
   const item=fields[i++],space=item.indexOf(' '),key=space<0?item:item.slice(0,space),value=space<0?'':item.slice(space+1);
   if(['author','author-time','author-tz','summary','filename'].includes(key)){
    if(Object.hasOwn(metadata,key))throw new Error('Duplicate blame metadata');metadata[key]=value;
   }
  }
  if(i===fields.length||!['author','author-time','author-tz','summary','filename'].every(k=>Object.hasOwn(metadata,k)))throw new Error('Incomplete blame record');
  if(!/^-?[0-9]+$/.test(metadata['author-time'])||!Number.isSafeInteger(Number(metadata['author-time']))||! /^[+-][0-9]{4}$/.test(metadata['author-tz']))throw new Error('Invalid blame timestamp');
  rows.push({commit:header[1],originalLine,line,author:metadata.author,authorTime:Number(metadata['author-time']),authorTimezone:metadata['author-tz'],summary:metadata.summary,text:fields[i++].slice(1)});
  if(rows.length>maxLines)throw new Error('Blame line limit exceeded');
 }
 return rows;
}
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
