import {createHash} from 'node:crypto';
import {parseVerifiedCommit} from './verified-commit.mjs';
import {encodeGitTag,parseVerifiedGitTag} from './git-tag-object.mjs';

const MAX_COMMIT_BYTES=2*1024*1024,MAX_MESSAGE_BYTES=64*1024;
const nativeAborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const nativeAbort=AbortSignal.prototype.throwIfAborted;
function owned(bytes){const copy=Buffer.alloc(bytes.length);Buffer.prototype.copy.call(bytes,copy);return copy;}
function record(value,keys,required,label){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Invalid Git tag plan '+label+' record');
 const out=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||!keys.includes(key))throw Error('Unsupported Git tag plan '+label+' field');
  const d=Object.getOwnPropertyDescriptor(value,key);
  if(!d||!Object.hasOwn(d,'value'))throw Error('Git tag plan '+label+' requires own data properties');
  out[key]=d.value;
 }
 for(const key of required)if(!Object.hasOwn(out,key))throw Error('Missing Git tag plan '+label+' '+key);
 return out;
}
function abortCheck(signal){
 if(signal===undefined)return ()=>{};
 let native=false;try{Reflect.apply(nativeAborted,signal,[]);native=true;}catch{}
 if(native)return ()=>Reflect.apply(nativeAbort,signal,[]);
 const s=record(signal,['aborted','throwIfAborted'],[],'signal');
 if(s.aborted!==undefined&&typeof s.aborted!=='boolean'||s.throwIfAborted!==undefined&&typeof s.throwIfAborted!=='function')throw Error('Invalid Git tag plan signal');
 return ()=>{if(s.aborted){const e=Error('Git tag verification aborted');e.name='AbortError';throw e;}if(s.throwIfAborted)Reflect.apply(s.throwIfAborted,signal,[]);};
}

// Pure synchronous plan over a raw commit BODY (<=2 MiB), copied before even
// inputs descriptor/prototype traps. Exact own-data plain/null-prototype inputs
// require target, tag, tagger and message; only objectFormat and signal are optional.
// The <=64 KiB strict UTF-8 message, scalar target/tag and full tagger identity are
// captured and validated before the first cancellation callback. Signal policy
// matches git-tag-object: intrinsic native checks or captured cooperative own-data
// aborted/throwIfAborted; caller getters are never invoked (no Proxy isolation).
// Commit syntax/hash is authenticated, not referenced-object existence, repository
// authorization/freshness or ref absence. No I/O, lookup, signing or publication.
// All result records are frozen EXCEPT the owned mutable object.body Buffer.
// A later publisher MUST recompute/verify that body's OID and revalidate ref state;
// freezing the wrapper does not authenticate subsequent Buffer mutations.
export function createVerifiedTagPlan(commitBody,inputs={}){
 if(!Buffer.isBuffer(commitBody))throw Error('Git commit body must be a Buffer');
 if(commitBody.length>MAX_COMMIT_BYTES)throw Error('Git commit body byte limit exceeded');
 const body=owned(commitBody);
 const r=record(inputs,['objectFormat','target','tag','tagger','message','signal'],['target','tag','tagger','message'],'input');
 const objectFormat=r.objectFormat===undefined?'sha1':r.objectFormat,target=r.target,tag=r.tag;
 const tagger=record(r.tagger,['name','email','timestamp','timezone'],['name','email','timestamp','timezone'],'tagger');
 for(const key of ['name','email','timezone'])if(typeof tagger[key]!=='string')throw Error('Git identity '+key+' must be a string');
 if(typeof tagger.timestamp!=='number')throw Error('Invalid Git identity timestamp');
 let message=r.message;
 if(Buffer.isBuffer(message)){
  if(message.length>MAX_MESSAGE_BYTES)throw Error('Git tag message byte limit exceeded');
  message=owned(message);
 }
 // Delegate every scalar/UTF-8/name/identity/byte-limit validation on owned data,
 // with no caller signal involved. No invalid capture can invoke a callback.
 encodeGitTag({object:target,tag,tagger,message},{objectFormat});
 const check=abortCheck(r.signal);
 // The commit parser's legacy aborted read is adapted to our captured policy;
 // no read of a caller-controlled aborted getter can precede the body snapshot.
 const commitSignal={get aborted(){check();return false;}};
 const verified=parseVerifiedCommit(body,{oid:target,objectFormat,signal:commitSignal});
 const encoded=encodeGitTag({object:verified.oid,tag,tagger,message},{objectFormat});
 check();
 const canonical=parseVerifiedGitTag(encoded.body,{oid:encoded.oid,objectFormat});
 check();
 const ref='refs/tags/'+canonical.tag;
 // JSON tuple framing is unambiguous; Git target OID already binds targetTree.
 const id=createHash('sha256').update(JSON.stringify(['dsh-vcs:verified-tag-plan:v1',objectFormat,verified.oid,canonical.oid,ref]),'utf8').digest('hex');
 return Object.freeze({id,action:'tag-create',objectFormat,target:verified.oid,targetTree:verified.tree,tag:canonical.tag,ref,tagger:canonical.tagger,message:canonical.message,messageBytes:canonical.messageBytes,object:Object.freeze({oid:canonical.oid,body:encoded.body})});
}
