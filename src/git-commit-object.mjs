import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';

// Pure object encoding: no filesystem, repository/ref lookup, subprocess or network.
// OIDs are full lowercase nonzero hex; no existence or referenced-object type check.
// Modes are canonical octal strings: 100644, 100755, 40000 only. Symlinks
// (120000), gitlinks (160000), numeric modes and aliases such as 040000 are rejected.
// Names/messages accept strings or Buffers with strict UTF-8 (no surrogate repair).
// Names retain spelling/case, except .git is rejected case-insensitively. This is
// object encoding, not a portable checkout-path validator (backslash is allowed).
// Limits: 100000 entries, 4096 bytes/name, 8 MiB tree body; 1024 UTF-8 bytes
// per nonblank identity name/email; 16 unique parents; 64 KiB message (NUL-free).
// Timestamps are nonnegative safe integers; offsets are +/-HHMM, minutes <60,
// maximum absolute offset 1400. Messages preserve all bytes/final-newline state.
// Returned bodies are owned copies, never views of caller buffers or other results.
const MAX_TREE_BYTES=8*1024*1024,MAX_ENTRIES=100000,MAX_NAME_BYTES=4096;
const MAX_IDENTITY_BYTES=1024,MAX_MESSAGE_BYTES=64*1024;
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function formatInfo(objectFormat){
 if(objectFormat!=='sha1'&&objectFormat!=='sha256')throw Error('Unsupported Git object format');
 return objectFormat==='sha1'?40:64;
}
function oidText(oid,length){
 if(typeof oid!=='string'||oid.length!==length||/[^0-9a-f]/.test(oid)||/^0+$/.test(oid))throw Error('Invalid Git object id');
 return oid;
}
function bytes(value,label,max){
 if(typeof value!=='string'&&!Buffer.isBuffer(value))throw Error(label+' must be a string or Buffer');
 if(value.length>max)throw Error(label+' byte limit exceeded');
 const result=Buffer.from(value);
 if(result.length>max)throw Error(label+' byte limit exceeded');
 let decoded;
 try{decoded=utf8.decode(result);}catch{throw Error(label+' must be strict UTF-8');}
 if(typeof value==='string'&&decoded!==value)throw Error(label+' must be strict UTF-8');
 return {buffer:result,text:decoded};
}
function result(type,body,objectFormat){
 const oid=createHash(objectFormat).update(Buffer.from(type+' '+body.length+'\0','ascii')).update(body).digest('hex');
 return {body,oid};
}

export function encodeGitTree(entries,{objectFormat='sha1'}={}){
 const oidLength=formatInfo(objectFormat);
 if(!Array.isArray(entries))throw Error('Git tree entries must be an array');
 if(entries.length>MAX_ENTRIES)throw Error('Git tree entry limit exceeded');
 const seen=new Set(),encoded=[];
 let total=0;
 for(const entry of entries){
  if(!entry||typeof entry!=='object')throw Error('Invalid Git tree entry');
  const {buffer:name,text}=bytes(entry.name,'Git tree name',MAX_NAME_BYTES);
  if(!name.length||text==='.'||text==='..'||text.toLowerCase()==='.git'||/[\0/]/u.test(text))throw Error('Unsafe Git tree name');
  if(seen.has(text))throw Error('Duplicate Git tree name');
  seen.add(text);
  const mode=entry.mode;
  if(mode!=='100644'&&mode!=='100755'&&mode!=='40000')throw Error('Unsupported Git tree mode');
  const oid=oidText(entry.oid,oidLength);
  const header=Buffer.from(mode+' ','ascii');
  total+=header.length+name.length+1+oidLength/2;
  if(total>MAX_TREE_BYTES)throw Error('Git tree byte limit exceeded');
  encoded.push({key:mode==='40000'?Buffer.concat([name,Buffer.from('/')]):name,parts:[header,name,Buffer.from([0]),Buffer.from(oid,'hex')]});
 }
 encoded.sort((a,b)=>Buffer.compare(a.key,b.key));
 const parts=[];
 for(const entry of encoded)parts.push(...entry.parts);
 return result('tree',Buffer.concat(parts,total),objectFormat);
}
function identity(value,label){
 if(!value||typeof value!=='object')throw Error('Invalid Git '+label+' identity');
 const fields={};
 for(const key of ['name','email']){
  if(typeof value[key]!=='string')throw Error('Git identity '+key+' must be a string');
  const {text}=bytes(value[key],'Git identity '+key,MAX_IDENTITY_BYTES);
  if(!text.trim()||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]/u.test(text))throw Error('Unsafe Git identity '+key);
  fields[key]=text;
 }
 const {timestamp,timezone}=value;
 if(!Number.isSafeInteger(timestamp)||timestamp<0)throw Error('Invalid Git identity timestamp');
 if(typeof timezone!=='string'||timezone.length!==5||!/^[-+][0-9]{4}$/.test(timezone))throw Error('Invalid Git identity timezone');
 const hours=Number(timezone.slice(1,3)),minutes=Number(timezone.slice(3));
 if(minutes>59||hours>14||(hours===14&&minutes!==0))throw Error('Invalid Git identity timezone');
 return fields.name+' <'+fields.email+'> '+timestamp+' '+timezone;
}

export function encodeGitCommit(input,{objectFormat='sha1'}={}){
 const oidLength=formatInfo(objectFormat);
 if(!input||typeof input!=='object')throw Error('Invalid Git commit input');
 const tree=oidText(input.tree,oidLength),parents=input.parents===undefined?[]:input.parents;
 if(!Array.isArray(parents)||parents.length>16)throw Error('Git commit parents must be an array of at most 16');
 const seen=new Set(),headers=['tree '+tree];
 for(const parent of parents){
  oidText(parent,oidLength);
  if(seen.has(parent))throw Error('Duplicate Git commit parent');
  seen.add(parent);headers.push('parent '+parent);
 }
 headers.push('author '+identity(input.author,'author'),'committer '+identity(input.committer,'committer'));
 const {buffer:message}=bytes(input.message,'Git commit message',MAX_MESSAGE_BYTES);
 if(message.includes(0))throw Error('Git commit message must not contain NUL');
 return result('commit',Buffer.concat([Buffer.from(headers.join('\n')+'\n\n','utf8'),message]),objectFormat);
}
