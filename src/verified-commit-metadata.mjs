import {TextDecoder} from 'node:util';
import {parseVerifiedCommit} from './verified-commit.mjs';

const MAX_BODY_BYTES=2*1024*1024,MAX_MESSAGE_BYTES=64*1024,MAX_IDENTITY_FIELD_BYTES=1024;
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function captureOptions(value){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Invalid Git commit metadata options record');
 const captured=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(!['oid','objectFormat','signal'].includes(key))throw Error('Unsupported Git commit metadata option');
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))throw Error('Git commit metadata options must be own data properties');
  captured[key]=descriptor.value;
 }
 return captured;
}
function checkAbort(signal){
 if(signal?.aborted){const error=new Error('Git commit metadata read aborted');error.name='AbortError';throw error;}
}
function readIdentity(line,role){
 // Header grammar, UTF-8, safe integer range and timezone were authenticated
 // and validated by parseVerifiedCommit. Never trim or normalize these fields.
 const match=/^([^<>]+) <([^<>]+)> (0|[1-9][0-9]*) ([-+][0-9]{4})$/.exec(utf8.decode(line.subarray(role.length+1)));
 if(!match)throw Error('Unsupported Git commit metadata identity');
 const [,name,email,timestamp,timezone]=match;
 if(Buffer.byteLength(name)>MAX_IDENTITY_FIELD_BYTES||Buffer.byteLength(email)>MAX_IDENTITY_FIELD_BYTES)throw Error('Git commit metadata identity field byte limit exceeded');
 return Object.freeze({name,email,timestamp:Number(timestamp),timezone});
}

// Pure, read-only projection of authenticated raw commit BODY bytes. No refs,
// I/O, object-existence checks, or amend eligibility/authorization are implied.
// Snapshot before inspecting options (including Proxy traps) or signal callbacks.
// Inherits the verifier's strict header grammar and 0..16-parent support.
// Empty/blank messages, BOM, CRLF and missing final LF are preserved exactly;
// unlike the tree-only parser this projection rejects unsupported message UTF-8
// and Cc controls except LF/TAB/CR. It does not impose commit-UI write policy.
// messageBytes is a scalar byte count, never an exposed mutable body Buffer.
export function readVerifiedCommitMetadata(bytes,options={}){
 if(!Buffer.isBuffer(bytes))throw Error('Git commit bytes must be a Buffer');
 if(bytes.length>MAX_BODY_BYTES)throw Error('Git commit body byte limit exceeded');
 const body=Buffer.alloc(bytes.length);Buffer.prototype.copy.call(bytes,body);
 const captured=captureOptions(options),{signal}=captured;
 const verified=parseVerifiedCommit(body,captured);
 checkAbort(signal);
 const separator=body.indexOf('\n\n'),messageBytes=body.length-separator-2;
 if(messageBytes>MAX_MESSAGE_BYTES)throw Error('Git commit metadata message byte limit exceeded');
 let message;
 try{message=utf8.decode(body.subarray(separator+2));}catch{throw Error('Unsupported Git commit metadata message: strict UTF-8 required');}
 if(/[\p{Cc}]/u.test(message.replace(/[\n\t\r]/g,'')))throw Error('Unsupported Git commit metadata message control character');
 let author,committer;
 for(const line of body.subarray(0,separator).toString('utf8').split('\n')){
  if(line.startsWith('author '))author=readIdentity(Buffer.from(line),'author');
  else if(line.startsWith('committer '))committer=readIdentity(Buffer.from(line),'committer');
 }
 checkAbort(signal);
 return Object.freeze({...verified,author,committer,message,messageBytes});
}
