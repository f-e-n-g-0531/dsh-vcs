import {createHash} from 'node:crypto';

const MAX_NODES=10000,MAX_PARENTS=16;
const fail=message=>new Error('Git branch delete plan: '+message);
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
function array(value,max,label){
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)throw fail('Invalid '+label+' array');
 const length=Object.getOwnPropertyDescriptor(value,'length');
 if(!length||!Object.hasOwn(length,'value')||!Number.isInteger(length.value)||length.value>max)throw fail(label+' limit exceeded');
 const size=length.value,keys=Reflect.ownKeys(value);
 if(keys.length!==size+1)throw fail(label+' must be dense without extra fields');
 const out=[];
 for(let i=0;i<size;i++){
  const descriptor=Object.getOwnPropertyDescriptor(value,String(i));
  if(!descriptor||!Object.hasOwn(descriptor,'value'))throw fail(label+' requires dense own data elements');
  out.push(descriptor.value);
 }
 return out;
}
function oid(value,width){
 if(typeof value!=='string'||value.length!==width||/[^0-9a-f]/.test(value)||/^0+$/.test(value))throw fail('Invalid object id');
 return value;
}
function ref(value){
 if(typeof value!=='string'||!value.startsWith('refs/heads/'))throw fail('Full refs/heads branch required');
 const name=value.slice(11);
 // Same portable short-name policy as branch-create-preview (without importing I/O).
 if(!name||Buffer.from(name,'utf8').toString('utf8')!==name||Buffer.byteLength(name,'utf8')>1000||
  name==='@'||name.toUpperCase()==='HEAD'||name.startsWith('-')||name.startsWith('refs/')||/[\x00-\x20\x7f~^:?*\[\\<>"|\p{Cc}\p{Cf}]/u.test(name)||name.includes('..')||name.includes('@{')||
  name.split('/').some(p=>!p||Buffer.byteLength(p,'utf8')>255||p.startsWith('.')||/[. ]$/.test(p)||p.toLowerCase().endsWith('.lock')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw fail('Safe portable branch name required');
 return value;
}

// Pure synchronous proposal, NOT deletion authorization. No filesystem, subprocess,
// network, object bytes, reference lookup or writes. Supplied OIDs/parent assertions
// are not authenticated: a future consumer must verify objects and fresh refs,
// worktrees, configuration and repository safety independently before any deletion.
// Require a CLOSED graph, both tip rows (even identical tips), and no cycle ANYWHERE.
// This deliberately rejects truncated histories even when a path could prove ancestry.
// <=10,000 rows, <=16 unique parents each (<=160,000 edges); iterative DFS only.
// Parent sets and rows sort by lowercase ASCII hex OID; canonical parent-order DFS
// produces the same proof/ID regardless of input row or parent permutations.
// ID = SHA256(UTF8(JSON.stringify([domain,format,[currentRef,currentOID],
// [targetRef,targetOID],sortedRowsOf[oid,sortedParents]]))). No force/merged inputs.
// Case-insensitive aliases of the current ref are rejected conservatively on ALL OSes.
// All records, arrays and scalar values are captured/validated before signal access.
// Signal callbacks can mutate caller inputs, never the owned graph. Cancellation is
// synchronous/cooperative; event-loop aborts cannot interrupt a synchronous call.
export function createBranchDeletePlan(inputs){
 const captured=record(inputs,['current','target','commits'],['objectFormat','signal'],'input');
 const {objectFormat='sha1',signal}=captured;
 if(objectFormat!=='sha1'&&objectFormat!=='sha256')throw fail('Unsupported object format');
 const width=objectFormat==='sha1'?40:64;
 const captureTip=(value,label)=>{
  const tip=record(value,['ref','oid'],[],label);
  return Object.freeze({ref:ref(tip.ref),oid:oid(tip.oid,width)});
 };
 const current=captureTip(captured.current,'current'),target=captureTip(captured.target,'target');
 if(current.ref.toLowerCase()===target.ref.toLowerCase())throw fail('Cannot delete current branch or case-insensitive alias');
 const rows=array(captured.commits,MAX_NODES,'commits').map(value=>{
  const row=record(value,['oid','parents'],[],'commit');
  const parents=array(row.parents,MAX_PARENTS,'parents').map(value=>oid(value,width));
  if(new Set(parents).size!==parents.length)throw fail('Duplicate parent');
  return {oid:oid(row.oid,width),parents:parents.sort()};
 }).sort((a,b)=>a.oid<b.oid?-1:a.oid>b.oid?1:0);
 const graph=new Map();
 for(const row of rows){if(graph.has(row.oid))throw fail('Duplicate commit node');graph.set(row.oid,row.parents);}
 if(!graph.has(current.oid)||!graph.has(target.oid))throw fail('Missing current or target commit node');
 for(const row of rows)for(const parent of row.parents)if(!graph.has(parent))throw fail('Missing parent commit node: graph must be closed');
 const check=()=>{
  signal?.throwIfAborted?.();
  if(signal?.aborted){const error=fail('Aborted');error.name='AbortError';throw error;}
 };
 check();
 const colors=new Map();
 for(const row of rows){
  if(colors.has(row.oid))continue;
  colors.set(row.oid,1);
  const stack=[{oid:row.oid,next:0}];
  while(stack.length){
   check();
   const frame=stack[stack.length-1],parents=graph.get(frame.oid);
   if(frame.next===parents.length){colors.set(frame.oid,2);stack.pop();continue;}
   const parent=parents[frame.next++],color=colors.get(parent);
   if(color===1)throw fail('Cyclic commit graph');
   if(color!==2){colors.set(parent,1);stack.push({oid:parent,next:0});}
  }
 }
 const seen=new Set([current.oid]),path=[current.oid],stack=[{oid:current.oid,next:0}];
 while(stack.length&&path[path.length-1]!==target.oid){
  check();
  const frame=stack[stack.length-1],parents=graph.get(frame.oid);
  if(frame.next===parents.length){stack.pop();path.pop();continue;}
  const parent=parents[frame.next++];
  if(!seen.has(parent)){seen.add(parent);stack.push({oid:parent,next:0});path.push(parent);}
 }
 if(!path.length)throw fail('Target is not merged into current tip');
 const id=createHash('sha256').update(JSON.stringify(['dsh-branch-delete-plan-v1',objectFormat,[current.ref,current.oid],[target.ref,target.oid],rows.map(row=>[row.oid,row.parents])])).digest('hex');
 const result=Object.freeze({id,action:'branch-delete',objectFormat,current,target,merged:true,proof:Object.freeze(path)});
 check();
 return result;
}
