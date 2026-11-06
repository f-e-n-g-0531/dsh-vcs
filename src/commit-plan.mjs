import {createHash} from 'node:crypto';
import {parseGitIndex} from './git-index.mjs';
import {buildIndexTree} from './index-tree.mjs';
import {encodeGitCommit} from './git-commit-object.mjs';

const MAX_INDEX_BYTES=8*1024*1024;
const APPROVED_EXTENSIONS=new Set(['TREE','EOIE','IEOT']);
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function oid(value,width,label){
 if(typeof value!=='string'||value.length!==width||/[^0-9a-f]/.test(value)||/^0+$/.test(value))throw Error('Invalid Git commit plan '+label+' object id');
 return value;
}
function owned(bytes){const copy=Buffer.alloc(bytes.length);bytes.copy(copy);return copy;}
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

// Pure, synchronous assembly for a born, exactly-one-parent commit. No filesystem,
// subprocess, worktree, object lookup, refs, ambient cancellation or publication.
// Copy the <=8 MiB raw index before inspecting options. parseGitIndex verifies its
// format-specific checksum and stage-0 regular entries. Only opaque, bounded
// TREE/EOIE/IEOT cache extensions are accepted; trees are rebuilt from entries.
// Identity, time and message encoding use encodeGitCommit's exact validation.
// Unlike that primitive, this API rejects trim-empty messages. Nonblank messages
// retain every byte, including leading/trailing whitespace and newline state.
// Cancellation is checked around phases, never awaited: an event-loop abort
// cannot interrupt synchronous execution. No reference/object existence, type or
// freshness is proven; the supplied parentTree is not resolved from parent.
// Metadata is frozen; each body is an independent owned *mutable* Buffer. There
// is no private retained state, no frozen-Buffer claim and no execution capability.
// Consumers must revalidate bytes/OIDs and fresh repository state before any I/O.
// id = SHA256(UTF8(JSON.stringify([domain,indexDigest,format,parent,parentTree,
// root,commitOID]))), where indexDigest is SHA256 of the exact raw index bytes.
export function createIndexCommitPlan(indexBuffer,inputs={}){
 if(!Buffer.isBuffer(indexBuffer))throw Error('Git index must be a Buffer');
 if(indexBuffer.length>MAX_INDEX_BYTES)throw Error('Git index byte limit exceeded');
 const snapshot=owned(indexBuffer);
 const captured=dataRecord(inputs,['objectFormat','parent','parentTree','author','committer','message','signal'],'input');
 const {objectFormat='sha1',parent,parentTree,message,signal}=captured;
 const author=captureIdentity(captured.author,'author'),committer=captureIdentity(captured.committer,'committer');
 if(Buffer.isBuffer(message)&&message.length>64*1024)throw Error('Git commit message byte limit exceeded');
 const messageSnapshot=Buffer.isBuffer(message)?owned(message):message;
 const check=()=>signal?.throwIfAborted();
 check();
 if(objectFormat!=='sha1'&&objectFormat!=='sha256')throw Error('Unsupported Git commit plan object format');
 const width=objectFormat==='sha1'?40:64;
 oid(parent,width,'parent');oid(parentTree,width,'parent tree');
 const parsed=parseGitIndex(snapshot,{objectFormat});
 if(parsed.extensions.some(extension=>!APPROVED_EXTENSIONS.has(extension.signature)))throw Error('Unsupported semantic Git index extension for commit plan');
 check();
 const built=buildIndexTree(parsed.entries,{objectFormat});
 check();
 if(built.root===parentTree)throw Error('Git commit plan is a no-op: index tree equals parent tree');
 const encoded=encodeGitCommit({tree:built.root,parents:[parent],author,committer,message:messageSnapshot},{objectFormat});
 if(!messageSnapshot.toString().trim())throw Error('Git commit plan message must be nonblank');
 check();
 const indexDigest=sha256(snapshot),tree=built.root;
 const id=sha256(JSON.stringify(['dsh-index-commit-plan-v1',indexDigest,objectFormat,parent,parentTree,tree,encoded.oid]));
 const commit=Object.freeze({oid:encoded.oid,body:owned(encoded.body)});
 const trees=Object.freeze(built.trees.map(value=>Object.freeze({path:value.path,oid:value.oid,body:owned(value.body)})));
 const plan=Object.freeze({id,objectFormat,indexDigest,parent,parentTree,tree,commit,trees});
 check();
 return plan;
}
