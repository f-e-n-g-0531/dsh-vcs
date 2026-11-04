import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {parseTreeEntries} from './historical-access.mjs';
import {currentOperationBudget} from './operation-budget.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const secret = randomBytes(32);
const invalid = () => Error('Invalid content search cursor');
const binding = (root,snapshot,query) => createHash('sha256').update(JSON.stringify([root,snapshot,query])).digest('hex');
const sign = body => createHmac('sha256',secret).update(body).digest('base64url');
function encode(state) { const body=Buffer.from(JSON.stringify(state)).toString('base64url');return body+'.'+sign(body); }
function decode(cursor,root,snapshot,query) {
  if(typeof cursor!=='string'||cursor.length>4096)throw invalid();
  const [body,mac,...extra]=cursor.split('.');
  if(!body||!mac||extra.length||!/^[A-Za-z0-9_-]+$/.test(body)||!/^[A-Za-z0-9_-]{43}$/.test(mac)||!timingSafeEqual(Buffer.from(mac),Buffer.from(sign(body))))throw invalid();
  let state;try{state=JSON.parse(Buffer.from(body,'base64url').toString());}catch{throw invalid();}
  if(state.binding!==binding(root,snapshot,query)||!Number.isSafeInteger(state.index)||state.index<0||!Number.isSafeInteger(state.offset)||state.offset<0||state.offset>MAX_BYTES||!Number.isSafeInteger(state.line)||state.line<1||typeof state.skipped!=='boolean')throw invalid();
  return state;
}

/** Stable object/tree positions, not an offset into a capped grep result set. */
export async function searchContentPage(run,root,{snapshot,query,cursor,limit=100,signal}) {
  if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid content search page size');
  const check=()=>{signal?.throwIfAborted();currentOperationBudget()?.throwIfExpired();};
  check();
  const state=cursor===undefined?{binding:binding(root,snapshot,query),index:0,offset:0,line:1,skipped:false}:decode(cursor,root,snapshot,query);
  const listing=await run(root,['ls-tree','-r','-z','--full-tree',snapshot],MAX_BYTES,{signal});
  const entries=parseTreeEntries(listing).filter(entry=>entry.type==='blob'&&['100644','100755'].includes(entry.mode));
  if(state.index>entries.length)throw invalid();
  const matches=[],needle=Buffer.from(query),warnings=[];
  let scannedBytes=0,responseBytes=0,files=0,reason=null;
  while(state.index<entries.length) {
    check();
    if(matches.length>=limit){reason='page-limit';break;}
    if(files>=64||scannedBytes>=MAX_BYTES){reason='scan-budget';break;}
    const entry=entries[state.index];
    const rawSize=(await run(root,['cat-file','-s',entry.oid],2097152,{signal})).toString().trim();
    if(!/^\d+$/.test(rawSize)||!Number.isSafeInteger(Number(rawSize)))throw Error('Invalid search object size');
    const size=Number(rawSize);
    if(size>MAX_BYTES){state.skipped=true;state.index++;state.offset=0;state.line=1;files++;continue;}
    if(files&&scannedBytes+size>MAX_BYTES){reason='scan-budget';break;}
    const body=await run(root,['cat-file','blob',entry.oid],Math.max(1,size),{signal});
    scannedBytes+=body.length;files++;
    if(body.length!==size||state.offset>size)throw Error('Search object size mismatch');
    // Match git grep -I: binary files are outside this text-search domain.
    if(body.includes(0)){state.index++;state.offset=0;state.line=1;continue;}
    let pos=state.offset,line=state.line;
    while(pos<body.length) {
      check();
      // Single pass: CR-only input must not rescan the remaining blob for LF per line.
      let end=pos;
      while(end<body.length&&body[end]!==10&&body[end]!==13){
        if((end & 65535)===0)check();
        end++;
      }
      const hit=body.subarray(pos,end).indexOf(needle);
      if(hit>=0) {
        let textEnd=Math.min(end,pos+4096);
        while(textEnd<end&&(body[textEnd]&192)===128)textEnd--;
        const match={path:entry.path,line,text:body.subarray(pos,textEnd).toString('utf8'),...(textEnd<end?{textTruncated:true}:{})};
        const matchBytes=Buffer.byteLength(JSON.stringify(match));
        if(responseBytes+matchBytes>1024*1024){reason='page-limit';break;}
        matches.push(match);responseBytes+=matchBytes;
      }
      pos=end<body.length?end+(body[end]===13&&body[end+1]===10?2:1):end;line++;
      if(matches.length>=limit)break;
    }
    if(pos>=body.length){state.index++;state.offset=0;state.line=1;}
    else {state.offset=pos;state.line=line;reason='page-limit';break;}
  }
  check();
  const more=state.index<entries.length;
  if(state.skipped)warnings.push('Files exceeding the 16 MiB text-search limit were skipped.');
  return {snapshot,query,matches,nextCursor:more?encode(state):null,complete:!more&&!state.skipped,truncated:more||state.skipped,reason:reason??(state.skipped?'unsupported-content':null),warnings};
}
