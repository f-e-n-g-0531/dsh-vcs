import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';

// Pure verification of raw commit BODY bytes, not a loose-object/zlib envelope.
// No I/O, refs, referenced-object existence/type checks, or returned body ownership.
// Snapshot Buffer synchronously (<=2 MiB); hash Git's commit + length + NUL framing.
// Header bytes including the blank separator are <=128 KiB, at most 256 lines.
// Initial scope: tree, 0..16 unique contiguous parents, author, committer, then
// optionally exact `encoding UTF-8`. All other headers and continuations (including
// gpgsig/mergetag) are rejected, not skipped. LF framing only; no header CR/NUL.
// Identities use strict UTF-8, nonblank NAME <EMAIL>, nonnegative safe integer
// timestamp, +/-HHMM offset <=1400 (minutes <60), and no controls/angle injection.
// Message bytes after the mandatory blank line are opaque: invalid UTF-8, CR,
// NUL, and header-like text are allowed, within the overall 2 MiB body limit.
const MAX_BODY_BYTES=2*1024*1024,MAX_HEADER_BYTES=128*1024,MAX_HEADERS=256;
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function checkAbort(signal){
 if(signal?.aborted){
  const error=new Error('Git commit verification aborted');error.name='AbortError';throw error;
 }
}
function validOid(value,width){
 if(typeof value!=='string'||value.length!==width||/[^0-9a-f]/.test(value)||/^0+$/.test(value))throw Error('Invalid Git object id');
 return value;
}
function validateIdentity(value){
 let text;
 try{text=utf8.decode(value);}catch{throw Error('Git identity must be strict UTF-8');}
 const match=/^([^<>]+) <([^<>]+)> (0|[1-9][0-9]*) ([-+][0-9]{4})$/.exec(text);
 if(!match||!match[1].trim()||!match[2].trim()||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(text))throw Error('Invalid Git identity');
 if(!Number.isSafeInteger(Number(match[3])))throw Error('Invalid Git identity timestamp');
 const hours=Number(match[4].slice(1,3)),minutes=Number(match[4].slice(3));
 if(minutes>59||hours>14||(hours===14&&minutes!==0))throw Error('Invalid Git identity timezone');
}

export function parseVerifiedCommit(bytes,options={}){
 if(!Buffer.isBuffer(bytes))throw Error('Git commit bytes must be a Buffer');
 if(bytes.length>MAX_BODY_BYTES)throw Error('Git commit body byte limit exceeded');
 const body=Buffer.from(bytes);
 const {oid,objectFormat='sha1',signal}=options;
 checkAbort(signal);
 if(objectFormat!=='sha1'&&objectFormat!=='sha256')throw Error('Unsupported Git object format');
 const width=objectFormat==='sha1'?40:64;
 validOid(oid,width);
 const actual=createHash(objectFormat).update(Buffer.from('commit '+body.length+'\0','ascii')).update(body).digest('hex');
 if(actual!==oid)throw Error('Git commit object id mismatch');
 checkAbort(signal);
 const header=body.subarray(0,MAX_HEADER_BYTES);
 let offset=0,count=0,tree,state='tree',encoding=false;
 const parents=[],seen=new Set();
 while(true){
  checkAbort(signal);
  const end=header.indexOf(10,offset);
  if(end<0)throw Error('Git commit missing separator or header byte limit exceeded');
  const line=header.subarray(offset,end);offset=end+1;
  if(!line.length){
   if(state!=='done')throw Error('Git commit missing required headers');
   break;
  }
  if(++count>MAX_HEADERS)throw Error('Git commit header count limit exceeded');
  if(line.includes(0)||line.includes(13))throw Error('Invalid Git commit header framing');
  const space=line.indexOf(32);
  if(space<=0)throw Error('Unsupported Git commit header or continuation');
  const key=line.subarray(0,space).toString('latin1'),value=line.subarray(space+1);
  if(key==='tree'&&state==='tree'){
   tree=validOid(value.toString('latin1'),width);state='parents';
  }else if(key==='parent'&&state==='parents'){
   const parent=validOid(value.toString('latin1'),width);
   if(parents.length===16)throw Error('Git commit parent limit exceeded');
   if(seen.has(parent))throw Error('Duplicate Git commit parent');
   seen.add(parent);parents.push(parent);
  }else if(key==='author'&&state==='parents'){
   validateIdentity(value);state='committer';
  }else if(key==='committer'&&state==='committer'){
   validateIdentity(value);state='done';
  }else if(key==='encoding'&&state==='done'&&!encoding&&value.equals(Buffer.from('UTF-8'))){
   encoding=true;
  }else{
   throw Error('Unsupported, duplicate or out-of-order Git commit header');
  }
 }
 checkAbort(signal);
 return Object.freeze({oid,tree,parents:Object.freeze(parents)});
}
