import {createHash} from 'node:crypto';
import {parseGitIndex} from './git-index.mjs';
import {buildIndexTree} from './index-tree.mjs';
import {encodeGitCommit} from './git-commit-object.mjs';
import {readVerifiedCommitMetadata} from './verified-commit-metadata.mjs';

const MAX_INDEX_BYTES=8*1024*1024,MAX_HEAD_BYTES=2*1024*1024,MAX_MESSAGE_BYTES=64*1024;
const APPROVED_EXTENSIONS=new Set(['TREE','EOIE','IEOT']);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function owned(bytes){const copy=Buffer.alloc(bytes.length);Buffer.prototype.copy.call(bytes,copy);return copy;}
function dataRecord(value,keys,label){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Invalid Git amend plan '+label+' record');
 const copy=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(!keys.includes(key))throw Error('Unsupported Git amend plan '+label+' field');
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))throw Error('Git amend plan '+label+' fields must be own data properties');
  copy[key]=descriptor.value;
 }
 return copy;
}
function captureCommitter(value){
 const copy=dataRecord(value,['name','email','timestamp','timezone'],'committer');
 for(const key of ['name','email','timezone'])if(typeof copy[key]!=='string')throw Error('Git identity '+key+' must be a string');
 if(typeof copy.timestamp!=='number')throw Error('Invalid Git identity timestamp');
 return copy;
}

// Pure synchronous amend assembly; no repository, object lookup, refs or I/O.
// Own both bounded raw inputs before any option/identity Proxy traps or callbacks.
// Authenticate HEAD before using its exact parsed author and ordered 0..16 parents.
// UTF-8 encoding headers are supported by the metadata reader; signatures and other
// headers are rejected rather than silently discarded. New commits use the encoder's
// canonical UTF-8 headers. Only the complete new commit OID determines a no-op.
// Freeze metadata, not Buffer contents. All bodies are independent owned mutable
// copies; neither these bytes nor the deterministic ID confer publication authority.
// ID = SHA256(UTF8(JSON.stringify([domain,indexDigest,format,oldHead,oldTree,
// originalParents,newTree,newCommitOID]))). Tree graph caps come from buildIndexTree.
export function createAmendPlan(indexBuffer,headBody,inputs={}){
 if(!Buffer.isBuffer(indexBuffer))throw Error('Git index must be a Buffer');
 if(indexBuffer.length>MAX_INDEX_BYTES)throw Error('Git index byte limit exceeded');
 if(!Buffer.isBuffer(headBody))throw Error('Git HEAD commit bytes must be a Buffer');
 if(headBody.length>MAX_HEAD_BYTES)throw Error('Git HEAD commit body byte limit exceeded');
 const indexSnapshot=owned(indexBuffer),headSnapshot=owned(headBody);
 const captured=dataRecord(inputs,['objectFormat','head','committer','message','signal'],'input');
 const {objectFormat='sha1',head,message,signal}=captured;
 const committer=captureCommitter(captured.committer);
 if(Buffer.isBuffer(message)&&message.length>MAX_MESSAGE_BYTES)throw Error('Git commit message byte limit exceeded');
 const messageSnapshot=Buffer.isBuffer(message)?owned(message):message;
 const check=()=>{
  signal?.throwIfAborted?.();
  if(signal?.aborted){const error=new Error('Git amend plan aborted');error.name='AbortError';throw error;}
 };
 check();
 const previous=readVerifiedCommitMetadata(headSnapshot,{oid:head,objectFormat});
 check();
 const parsed=parseGitIndex(indexSnapshot,{objectFormat});
 if(parsed.extensions.some(extension=>!APPROVED_EXTENSIONS.has(extension.signature)))throw Error('Unsupported semantic Git index extension for amend plan');
 check();
 const built=buildIndexTree(parsed.entries,{objectFormat});
 check();
 const encoded=encodeGitCommit({tree:built.root,parents:previous.parents,author:previous.author,committer,message:messageSnapshot},{objectFormat});
 const messageText=typeof messageSnapshot==='string'?messageSnapshot:messageSnapshot.toString('utf8');
 if(!messageText.trim())throw Error('Git amend plan message must be nonblank');
 if(encoded.oid===previous.oid)throw Error('Git amend plan is a no-op: commit object is unchanged');
 check();
 const indexDigest=sha256(indexSnapshot),tree=built.root;
 const id=sha256(JSON.stringify(['dsh-amend-plan-v1',indexDigest,objectFormat,previous.oid,previous.tree,previous.parents,tree,encoded.oid]));
 const commit=Object.freeze({oid:encoded.oid,body:owned(encoded.body)});
 const trees=Object.freeze(built.trees.map(value=>Object.freeze({path:value.path,oid:value.oid,body:owned(value.body)})));
 const result=Object.freeze({id,objectFormat,indexDigest,head:previous.oid,previousTree:previous.tree,parents:previous.parents,author:previous.author,committer:Object.freeze({...committer}),message:messageText,tree,commit,trees});
 check();
 return result;
}
