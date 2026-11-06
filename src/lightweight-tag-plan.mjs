import {createHash} from 'node:crypto';
import {parseVerifiedCommit} from './verified-commit.mjs';

const MAX_COMMIT_BYTES=2*1024*1024;
const nativeAborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
const nativeAbort=AbortSignal.prototype.throwIfAborted;
function owned(bytes){const copy=Buffer.alloc(bytes.length);Buffer.prototype.copy.call(bytes,copy);return copy;}
function record(value,keys,required,label){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Invalid lightweight tag plan '+label+' record');
 const out=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||!keys.includes(key))throw Error('Unsupported lightweight tag plan '+label+' field');
  const d=Object.getOwnPropertyDescriptor(value,key);
  if(!d||!Object.hasOwn(d,'value'))throw Error('Lightweight tag plan '+label+' requires own data properties');
  out[key]=d.value;
 }
 for(const key of required)if(!Object.hasOwn(out,key))throw Error('Missing lightweight tag plan '+label+' '+key);
 return out;
}
function tagName(name){
 if(typeof name!=='string'||!name||Buffer.from(name,'utf8').toString('utf8')!==name||Buffer.byteLength(name,'utf8')>1000||
  name==='@'||name.toUpperCase()==='HEAD'||name.startsWith('-')||name.startsWith('refs/')||/[\x00-\x20\x7f~^:?*\[\\<>"|\p{Cc}\p{Cf}]/u.test(name)||name.includes('..')||name.includes('@{')||
  name.split('/').some(p=>!p||Buffer.byteLength(p,'utf8')>255||p.startsWith('.')||/[. ]$/.test(p)||p.toLowerCase().endsWith('.lock')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw Error('Safe portable short tag name required');
 return name;
}
function abortCheck(signal){
 if(signal===undefined)return ()=>{};
 let native=false;try{Reflect.apply(nativeAborted,signal,[]);native=true;}catch{}
 if(native)return ()=>Reflect.apply(nativeAbort,signal,[]);
 const s=record(signal,['aborted','throwIfAborted'],[],'signal');
 if(s.aborted!==undefined&&typeof s.aborted!=='boolean'||s.throwIfAborted!==undefined&&typeof s.throwIfAborted!=='function')throw Error('Invalid lightweight tag plan signal');
 return ()=>{if(s.aborted){const e=Error('Lightweight tag verification aborted');e.name='AbortError';throw e;}if(s.throwIfAborted)Reflect.apply(s.throwIfAborted,signal,[]);};
}

// Pure synchronous plan over a raw commit BODY, not an object envelope. Capture the
// bounded Buffer with an intrinsic copy before any input descriptor/prototype traps.
// Exact own-data plain/null-prototype inputs require target/name; only objectFormat
// and signal are optional. Local name validation mirrors git-tag-object's portable
// 1000/255 UTF-8 byte policy without constructing any annotated tag object.
// All scalars are validated before the first callback. Native signals use captured
// intrinsics; cooperative own-data signals are snapshotted (no caller getters).
// Callbacks are trusted; this does not promise hostile Proxy isolation.
// Authenticates commit syntax/hash only: NOT ref absence, repository authorization,
// freshness or referenced-object existence. No I/O, object creation or publication.
// The exact frozen result contains no bodies, Buffers, parents or mutable records.
export function createVerifiedLightweightTagPlan(commitBody,inputs={}){
 if(!Buffer.isBuffer(commitBody))throw Error('Git commit body must be a Buffer');
 if(commitBody.length>MAX_COMMIT_BYTES)throw Error('Git commit body byte limit exceeded');
 const body=owned(commitBody);
 const r=record(inputs,['objectFormat','target','name','signal'],['target','name'],'input');
 const objectFormat=r.objectFormat===undefined?'sha1':r.objectFormat,target=r.target,name=tagName(r.name);
 if(objectFormat!=='sha1'&&objectFormat!=='sha256')throw Error('Unsupported Git object format');
 const width=objectFormat==='sha1'?40:64;
 if(typeof target!=='string'||target.length!==width||/[^0-9a-f]/.test(target)||/^0+$/.test(target))throw Error('Invalid Git object id');
 const check=abortCheck(r.signal);
 // Adapt the existing parser's legacy aborted read to captured cancellation policy.
 const signal={get aborted(){check();return false;}};
 const verified=parseVerifiedCommit(body,{oid:target,objectFormat,signal});
 check();
 const ref='refs/tags/'+name;
 // JSON tuple framing is unambiguous; authenticated target already binds its tree.
 const id=createHash('sha256').update(JSON.stringify(['dsh-vcs:lightweight-tag-plan:v1',objectFormat,ref,verified.oid]),'utf8').digest('hex');
 return Object.freeze({id,action:'lightweight-tag-create',objectFormat,name,ref,target:verified.oid,targetTree:verified.tree});
}
