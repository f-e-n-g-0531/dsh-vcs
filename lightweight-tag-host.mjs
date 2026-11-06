import {createConfirmedOperationCoordinator} from './confirmed-operation.mjs';

const invalid=message=>Object.assign(new Error(message),{code:'vcs/lightweight-tag-create-confirmation-invalid'});
function capture(address){
 if(!address||typeof address!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(address)))throw invalid('Invalid lightweight-tag-create address record.');
 const keys=['sessionId','repositoryId','name'],saved={};
 for(const key of Reflect.ownKeys(address)){
  if(!keys.includes(key))throw invalid('Unsupported lightweight-tag-create address field.');
  const descriptor=Object.getOwnPropertyDescriptor(address,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))throw invalid('Lightweight tag address requires own data properties.');
  saved[key]=descriptor.value;
 }
 if(keys.some(key=>!Object.hasOwn(saved,key))||typeof saved.sessionId!=='string'||!saved.sessionId||typeof saved.repositoryId!=='string'||!saved.repositoryId)throw invalid('Session, repository and tag name are required.');
 // Keep these portable short-name bounds aligned with lightweight-tag-preview.
 const name=saved.name;
 if(typeof name!=='string'||!name||Buffer.from(name,'utf8').toString('utf8')!==name||Buffer.byteLength(name,'utf8')>1000||
  name==='@'||name.toUpperCase()==='HEAD'||name.startsWith('-')||name.startsWith('refs/')||/[\x00-\x20\x7f~^:?*\[\\<>"|\p{Cc}\p{Cf}]/u.test(name)||name.includes('..')||name.includes('@{')||
  name.split('/').some(p=>!p||Buffer.byteLength(p,'utf8')>255||p.startsWith('.')||/[. ]$/.test(p)||p.toLowerCase().endsWith('.lock')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
  throw invalid('Safe portable short tag name required.');
 return Object.freeze(saved);
}

// Internal adapter, not an authorization layer: bindings and authorization callbacks
// must come from the authenticated host. No browser OID, ref or execution plan.
export function createLightweightTagCoordinator({api,now=Date.now,ttlMs=60000,maxTokens=32}){
 const coordinator=createConfirmedOperationCoordinator({
  operationKind:'lightweight-tag-create',now,ttlMs,maxTokens,
  prepare:(repository,{address,signal})=>api.prepareLightweightTagCreate({type:repository.type,root:repository.root},{name:address.name,signal}),
  execute:(repository,request)=>api.applyLightweightTagCreate({type:repository.type,root:repository.root},request),
  project:snapshot=>({action:'lightweight-tag-create',name:snapshot.name,ref:snapshot.ref,head:snapshot.head,currentRef:snapshot.currentRef,objectFormat:snapshot.objectFormat,targetTree:snapshot.targetTree,planId:snapshot.planId}),
  invalidCode:'vcs/lightweight-tag-create-confirmation-invalid',
  unknownCode:'vcs/lightweight-tag-create-outcome-unknown',
  unknownMessage:'Lightweight tag creation started but its final result could not be confirmed. Refresh the repository and inspect refs and HEAD before preparing another lightweight tag creation. Never retry automatically or roll back.',
 });
 return {
  // Capture own scalar data synchronously, before adapter or authorization awaits.
  async prepare(address,binding){return coordinator.prepare(capture(address),binding);},
  confirm:(address,binding)=>coordinator.confirm(address,binding),
  invalidate:entry=>coordinator.invalidate(entry),
  clear:()=>coordinator.clear(),
 };
}