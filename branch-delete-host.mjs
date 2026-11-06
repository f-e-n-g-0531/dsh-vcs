import {createConfirmedOperationCoordinator} from './confirmed-operation.mjs';

const invalid=message=>Object.assign(new Error(message),{code:'vcs/branch-delete-confirmation-invalid'});
function capture(address){
 if(!address||typeof address!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(address)))throw invalid('Invalid branch-delete address record.');
 const keys=['sessionId','repositoryId','name'],saved={};
 for(const key of Reflect.ownKeys(address)){
  if(!keys.includes(key))throw invalid('Unsupported branch-delete address field.');
  const descriptor=Object.getOwnPropertyDescriptor(address,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))throw invalid('Branch-delete address requires own data properties.');
  saved[key]=descriptor.value;
 }
 if(keys.some(key=>!Object.hasOwn(saved,key))||typeof saved.sessionId!=='string'||!saved.sessionId||typeof saved.repositoryId!=='string'||!saved.repositoryId)throw invalid('Session, repository and branch name are required.');
 // Keep these portable short-name bounds aligned with branch-delete-preview.
 const name=saved.name;
 if(typeof name!=='string'||!name||Buffer.from(name,'utf8').toString('utf8')!==name||Buffer.byteLength(name,'utf8')>1000||
  name==='@'||name.toUpperCase()==='HEAD'||name.startsWith('-')||name.startsWith('refs/')||/[\x00-\x20\x7f~^:?*\[\\<>"|\p{Cc}\p{Cf}]/u.test(name)||name.includes('..')||name.includes('@{')||
  name.split('/').some(p=>!p||Buffer.byteLength(p,'utf8')>255||p.startsWith('.')||/[. ]$/.test(p)||p.toLowerCase().endsWith('.lock')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
  throw invalid('Safe portable short branch name required.');
 return Object.freeze(saved);
}

// Internal only; no RPC/UI. Git old-OID CAS is not raw-ref-type CAS.
// The caller writer trust boundary excludes external raw-type swaps; the generic
// coordinator supplies process-shared writer exclusion, not external-process isolation.
// Internal adapter, not an authorization layer: bindings and authorization callbacks
// must come from the authenticated host. No browser OID, ref or execution plan.
export function createBranchDeleteCoordinator({api,now=Date.now,ttlMs=60000,maxTokens=32}){
 const coordinator=createConfirmedOperationCoordinator({
  operationKind:'branch-delete',now,ttlMs,maxTokens,
  prepare:(repository,{address,signal})=>api.prepareBranchDelete({type:repository.type,root:repository.root},{name:address.name,signal}),
  execute:(repository,request)=>api.applyBranchDelete({type:repository.type,root:repository.root},request),
  project:snapshot=>({action:'branch-delete',name:snapshot.name,ref:snapshot.ref,objectFormat:snapshot.objectFormat,current:{ref:snapshot.current.ref,oid:snapshot.current.oid},target:{ref:snapshot.target.ref,oid:snapshot.target.oid},merged:true,proof:[...snapshot.proof],planId:snapshot.planId}),
  invalidCode:'vcs/branch-delete-confirmation-invalid',
  unknownCode:'vcs/branch-delete-outcome-unknown',
  unknownMessage:'Branch deletion started but its final result could not be confirmed. Refresh the repository and inspect refs and HEAD before preparing another branch deletion. Never retry automatically, recreate the branch, or roll back.',
 });
 return {
  // Capture own scalar data synchronously, before adapter or authorization awaits.
  async prepare(address,binding){return coordinator.prepare(capture(address),binding);},
  confirm:(address,binding)=>coordinator.confirm(address,binding),
  invalidate:entry=>coordinator.invalidate(entry),
  clear:()=>coordinator.clear(),
 };
}
