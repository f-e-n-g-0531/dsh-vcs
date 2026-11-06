import {parseVerifiedCommit} from './src/verified-commit.mjs';
import {parseVerifiedGitTag} from './src/git-tag-object.mjs';
import {storeCapturedObject} from './git-object-store.mjs';
import {withOperationBudget,currentOperationBudget} from './src/operation-budget.mjs';

const invalid=message=>Object.assign(new Error(message),{code:'vcs/tag-object-invalid'});
function record(value,required,optional=[]){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalid('Expected own-data record.');
 const out=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(!required.includes(key)&&!optional.includes(key))throw invalid('Unexpected field.');
  const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))throw invalid('Accessors forbidden.');out[key]=d.value;
 }
 for(const key of required)if(!Object.hasOwn(out,key))throw invalid('Missing '+key+'.');
 return out;
}
const length=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength').get;
function captureObject(value,max){
 const row=record(value,['oid','body']);
 if(!Buffer.isBuffer(row.body))throw invalid('Object body must be a Buffer.');
 const size=Reflect.apply(length,row.body,[]);if(size>max)throw invalid('Object body bound exceeded.');
 const body=Buffer.alloc(size);Reflect.apply(Uint8Array.prototype.set,body,[row.body]);return {oid:row.oid,body};
}
// Internal append-only adapter. Caller verifies repository safety, target existence,
// ref absence, writer exclusion and authorization independently. No refs or target writes.
// Both bounded bodies are owned before callbacks/awaits; no hostile Proxy/shared-memory isolation.
export async function publishTagObject(input){
 const o=record(input,['gitDirectory','objectFormat','target','tag','assertAuthorized','onStart'],['signal']);
 const target=captureObject(o.target,2*1024*1024),tag=captureObject(o.tag,128*1024);
 if(typeof o.gitDirectory!=='string'||!['sha1','sha256'].includes(o.objectFormat)||typeof o.assertAuthorized!=='function'||typeof o.onStart!=='function')throw invalid('Invalid publication options.');
 if(o.signal!==undefined){try{Reflect.apply(Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get,o.signal,[]);}catch{throw invalid('Native AbortSignal required.');}}
 let started=false;
 try{return await withOperationBudget({signal:o.signal,timeoutMs:15000},async()=>{
  const budget=currentOperationBudget(),check=()=>budget.throwIfExpired();check();
  try{
   const verified=parseVerifiedCommit(target.body,{oid:target.oid,objectFormat:o.objectFormat,signal:budget.signal});
   const annotated=parseVerifiedGitTag(tag.body,{oid:tag.oid,objectFormat:o.objectFormat,signal:budget.signal});
   if(annotated.object!==verified.oid)throw invalid('Tag target mismatch.');
  }catch(cause){if(budget.signal.aborted)throw cause;throw invalid('Invalid authenticated target or tag: '+cause.message);}
  const authorize=async()=>{check();await o.assertAuthorized();check();};
  const start=()=>{if(started)return;started=true;const result=o.onStart();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw invalid('onStart must be synchronous.');}};
  await authorize();
  const result=await storeCapturedObject({gitDirectory:o.gitDirectory,objectFormat:o.objectFormat,type:'tag',bytes:tag.body,signal:budget.signal,assertAuthorized:authorize,onStart:start});
  await authorize();if(result.oid!==tag.oid)throw invalid('Stored tag OID mismatch.');return {oid:result.oid,created:result.created};
 });}catch(cause){
  if(!started)throw cause;
  throw Object.assign(new Error('Append-only tag publication started; inspect objects before further action. Never delete objects or retry automatically.',{cause}),{code:'vcs/tag-object-outcome-unknown',appendOnly:true,outcomeUnknown:true});
 }
}
