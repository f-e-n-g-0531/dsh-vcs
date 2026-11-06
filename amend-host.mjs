import {createConfirmedOperationCoordinator} from './confirmed-operation.mjs';
import {encodeGitCommit} from './src/git-commit-object.mjs';

const invalid=message=>Object.assign(new Error(message),{code:'vcs/amend-confirmation-invalid'});
function record(value,keys,label){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalid('Invalid '+label+' record.');
 const result={};
 for(const key of Reflect.ownKeys(value)){
  if(!keys.includes(key))throw invalid('Unsupported '+label+' field.');
  const descriptor=Object.getOwnPropertyDescriptor(value,key);
  if(!descriptor||!Object.hasOwn(descriptor,'value'))throw invalid(label+' requires own data properties.');
  result[key]=descriptor.value;
 }
 return result;
}
const identityKeys=['name','email','timestamp','timezone'];
const projectIdentity=value=>Object.fromEntries(identityKeys.map(key=>[key,value[key]]));
function capture(address){
 const saved=record(address,['sessionId','repositoryId','committer','message'],'amend address');
 saved.committer=record(saved.committer,identityKeys,'committer');
 if(typeof saved.sessionId!=='string'||!saved.sessionId||typeof saved.repositoryId!=='string'||!saved.repositoryId)throw invalid('Session and repository identifiers are required.');
 if(typeof saved.message!=='string'||Buffer.byteLength(saved.message)>65536||!saved.message.trim()||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(saved.message.replace(/[\n\t]/g,'')))throw invalid('Bounded plaintext commit message required.');
 // Validate the owned scalar metadata with the same pure bounds as the adapter.
 try{encodeGitCommit({tree:'1'.repeat(40),author:saved.committer,committer:saved.committer,message:saved.message});}
 catch{throw invalid('Invalid commit identity or message.');}
 Object.freeze(saved.committer);return Object.freeze(saved);
}

// Internal host adapter: authenticated grants and authorization callbacks remain
// the caller's responsibility. No raw browser repository paths or execution plans.
export function createAmendCoordinator({api,now=Date.now,ttlMs=60000,maxTokens=32}){
 const coordinator=createConfirmedOperationCoordinator({
  operationKind:'amend',now,ttlMs,maxTokens,
  prepare:(repository,{address,signal})=>api.prepareAmendPreview({type:repository.type,root:repository.root},{committer:address.committer,message:address.message,signal}),
  execute:(repository,request)=>api.applyAmendPreview({type:repository.type,root:repository.root},request),
  project:snapshot=>({action:'amend',head:snapshot.head,ref:snapshot.ref,objectFormat:snapshot.objectFormat,indexDigest:snapshot.indexDigest,previousTree:snapshot.previousTree,parents:[...snapshot.parents],tree:snapshot.tree,commit:{oid:snapshot.commit.oid},author:projectIdentity(snapshot.author),committer:projectIdentity(snapshot.committer),message:snapshot.message}),
  invalidCode:'vcs/amend-confirmation-invalid',
  unknownCode:'vcs/amend-outcome-unknown',
  unknownMessage:'Amend rewrites history. Amend started but its final result could not be confirmed. Append-only object writes may remain. Refresh the repository and inspect HEAD and the index before preparing another amend. Never retry automatically or roll back appended objects.',
 });
 return {
  // Capture before invoking even an asynchronous adapter or authorization callback.
  async prepare(address,binding){return coordinator.prepare(capture(address),binding);},
  confirm:(address,binding)=>coordinator.confirm(address,binding),
  invalidate:entry=>coordinator.invalidate(entry),
  clear:()=>coordinator.clear(),
 };
}
