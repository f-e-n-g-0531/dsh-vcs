import {createHash} from 'node:crypto';
import {parseVerifiedCommit} from './verified-commit.mjs';
import {createBranchDeletePlan} from './branch-delete-plan.mjs';

const MAX_BODY=2*1024*1024,MAX_TOTAL=16*1024*1024,MAX_NODES=10000;
const byteLength=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype),'byteLength').get;
const fail=message=>new Error('Verified Git branch delete plan: '+message);
function record(value,required,optional,label){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw fail('Invalid '+label+' record');
 const out=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(!required.includes(key)&&!optional.includes(key))throw fail('Unsupported '+label+' field');
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))throw fail(label+' requires own data properties');
  out[key]=descriptor.value;
 }
 for(const key of required)if(!Object.hasOwn(out,key))throw fail('Missing '+label+' '+key);
 return out;
}
function array(value){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)throw fail('Invalid objects array');
 const descriptor=Object.getOwnPropertyDescriptor(value,'length');
 if(!descriptor||!Object.hasOwn(descriptor,'value')||!Number.isInteger(descriptor.value)||descriptor.value>MAX_NODES)throw fail('Object count limit exceeded');
 const size=descriptor.value;
 if(Reflect.ownKeys(value).length!==size+1)throw fail('Objects must be dense without extra fields');
 const out=[];
 for(let i=0;i<size;i++){
  const item=Object.getOwnPropertyDescriptor(value,String(i));
  if(!item||!Object.hasOwn(item,'value'))throw fail('Objects require dense own data elements');
  out.push(item.value);
 }
 return out;
}
function oid(value,width){
 if(typeof value!=='string'||value.length!==width||/[^0-9a-f]/.test(value)||/^0+$/.test(value))throw fail('Invalid object id');
 return value;
}

// Pure, synchronous hash-authenticated CLOSED commit graph, not ref authentication,
// repository freshness, worktree/configuration safety, or deletion authorization.
// Strict supported headers (including signature rejection) come from parseVerifiedCommit;
// message bytes are opaque. Every supplied object, including disconnected nodes, is
// verified. Parent edges come only from authenticated raw headers, never assertions.
// Capture all scalars and bound aggregate bytes BEFORE copying; copy ALL bodies before
// any signal access. Cooperative callbacks cannot mutate owned bytes or captured tips.
// Descriptor/prototype traps on proxies may execute during capture: this is NOT an
// atomic snapshot across adversarial proxies or concurrently modified shared memory.
// Exact underlying plan shape/ID: verified OIDs bind bodies and ID binds the graph.
export function createVerifiedBranchDeletePlan(inputs){
 const captured=record(inputs,['current','target','objects'],['objectFormat','signal'],'input');
 const {objectFormat='sha1',signal}=captured;
 if(objectFormat!=='sha1'&&objectFormat!=='sha256')throw fail('Unsupported object format');
 const width=objectFormat==='sha1'?40:64;
 const tip=(value,label)=>{
  const out=record(value,['ref','oid'],[],label);
  if(typeof out.ref!=='string')throw fail('Invalid branch ref');
  return Object.freeze({ref:out.ref,oid:oid(out.oid,width)});
 };
 const current=tip(captured.current,'current'),target=tip(captured.target,'target');
 let total=0;
 const rows=array(captured.objects).map(value=>{
  const row=record(value,['oid','body'],[],'object');
  oid(row.oid,width);
  if(!Buffer.isBuffer(row.body))throw fail('Object body must be a Buffer');
  const size=byteLength.call(row.body);
  if(size>MAX_BODY)throw fail('Object body byte limit exceeded');
  total+=size;
  if(total>MAX_TOTAL)throw fail('Aggregate object body byte limit exceeded');
  return {oid:row.oid,body:row.body,size};
 });
 const snapshots=rows.map(row=>{
  const body=Buffer.alloc(row.size);
  Uint8Array.prototype.set.call(body,row.body);
  return {oid:row.oid,body};
 });
 const check=()=>{
  signal?.throwIfAborted?.();
  if(signal?.aborted){const error=fail('Aborted');error.name='AbortError';throw error;}
 };
 check();
 const commits=snapshots.map(({oid,body})=>{
  check();
  // Independently verify full Git framing before the strict parser authenticates it.
  const actual=createHash(objectFormat).update(Buffer.from('commit '+body.length+'\0','ascii')).update(body).digest('hex');
  if(actual!==oid)throw fail('Git commit object id mismatch');
  check();
  const parsed=parseVerifiedCommit(body,{oid,objectFormat,signal});
  check();
  return {oid:parsed.oid,parents:[...parsed.parents]};
 });
 check();
 const plan=createBranchDeletePlan({objectFormat,current,target,commits,signal});
 check();
 return plan;
}
