import {parseVerifiedCommit} from './verified-commit.mjs';
import {createIndexCommitPlan} from './commit-plan.mjs';

const MAX_INDEX_BYTES=8*1024*1024,MAX_PARENT_BYTES=2*1024*1024;
function owned(bytes){const copy=Buffer.alloc(bytes.length);Buffer.prototype.copy.call(bytes,copy);return copy;}
function dataRecord(value,keys,label){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Invalid Git commit plan '+label+' record');
 const captured=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(!keys.includes(key))throw Error('Unsupported Git commit plan '+label+' field');
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))throw Error('Git commit plan '+label+' fields must be own data properties');
  captured[key]=descriptor.value;
 }
 return captured;
}
function captureIdentity(value,label){
 const copy=dataRecord(value,['name','email','timestamp','timezone'],label);
 for(const key of ['name','email','timezone'])if(typeof copy[key]!=='string')throw Error('Git identity '+key+' must be a string');
 if(typeof copy.timestamp!=='number')throw Error('Invalid Git identity timestamp');
 return copy;
}

// Pure synchronous assembly: both bounded raw Buffers are copied before inspecting
// inputs (including descriptor/prototype traps) or calling cancellation callbacks.
// Inputs and identities follow createIndexCommitPlan's strict own-data policy.
// Only the authenticated parent's header supplies parentTree; message text cannot.
// The existing plan ID binds these exact parent bytes through their verified OID.
// Returned shape/owned mutable bodies match createIndexCommitPlan. This proves no
// object existence/type, repository freshness or authorization, and performs no I/O.
export function createVerifiedIndexCommitPlan(indexBuffer,parentBody,inputs={}){
 if(!Buffer.isBuffer(indexBuffer))throw Error('Git index must be a Buffer');
 if(indexBuffer.length>MAX_INDEX_BYTES)throw Error('Git index byte limit exceeded');
 if(!Buffer.isBuffer(parentBody))throw Error('Git parent commit bytes must be a Buffer');
 if(parentBody.length>MAX_PARENT_BYTES)throw Error('Git parent commit body byte limit exceeded');
 const indexSnapshot=owned(indexBuffer),parentSnapshot=owned(parentBody);
 const captured=dataRecord(inputs,['objectFormat','parent','author','committer','message','signal'],'input');
 const {objectFormat='sha1',parent,message,signal}=captured;
 const author=captureIdentity(captured.author,'author'),committer=captureIdentity(captured.committer,'committer');
 if(Buffer.isBuffer(message)&&message.length>64*1024)throw Error('Git commit message byte limit exceeded');
 const messageSnapshot=Buffer.isBuffer(message)?owned(message):message;
 const check=()=>signal?.throwIfAborted();
 check();
 const verified=parseVerifiedCommit(parentSnapshot,{oid:parent,objectFormat,signal});
 check();
 const plan=createIndexCommitPlan(indexSnapshot,{objectFormat,parent:verified.oid,parentTree:verified.tree,author,committer,message:messageSnapshot,signal});
 check();
 return plan;
}
