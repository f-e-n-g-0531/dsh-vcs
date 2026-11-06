import {createConfirmedOperationCoordinator} from './confirmed-operation.mjs';
import {encodeGitTag} from './src/git-tag-object.mjs';
const invalid=message=>Object.assign(new Error(message),{code:'vcs/tag-create-confirmation-invalid'});
function record(value,fields){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalid('Expected own-data record.');
 const out=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(!fields.includes(key))throw invalid('Unexpected field.');
  const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value'))throw invalid('Accessors forbidden.');out[key]=d.value;
 }
 for(const key of fields)if(!Object.hasOwn(out,key))throw invalid('Missing '+key+'.');
 return out;
}
function capture(address){
 const saved=record(address,['sessionId','repositoryId','name','tagger','message']);
 saved.tagger=record(saved.tagger,['name','email','timestamp','timezone']);
 if(typeof saved.sessionId!=='string'||!saved.sessionId||typeof saved.repositoryId!=='string'||!saved.repositoryId||typeof saved.message!=='string')throw invalid('Session, repository and string message required.');
 try{encodeGitTag({object:'1'.repeat(40),tag:saved.name,tagger:saved.tagger,message:saved.message});}catch{throw invalid('Invalid tag name, identity or message.');}
 Object.freeze(saved.tagger);return Object.freeze(saved);
}
// Internal factory only: authenticated bindings come from caller. No RPC/UI,
// external-process atomicity, signing or automatic rollback is implied.
export function createTagCreateCoordinator({api,now=Date.now,ttlMs=60000,maxTokens=32}){
 const coordinator=createConfirmedOperationCoordinator({operationKind:'tag-create',now,ttlMs,maxTokens,
  prepare:(repository,{address,signal})=>api.prepareTagCreate({type:repository.type,root:repository.root},{name:address.name,tagger:address.tagger,message:address.message,signal}),
  execute:(repository,request)=>api.applyTagCreate({type:repository.type,root:repository.root},request),
  project:s=>({action:'tag-create',name:s.name,ref:s.ref,objectFormat:s.objectFormat,head:s.head,currentRef:s.currentRef,targetTree:s.targetTree,tagger:{name:s.tagger.name,email:s.tagger.email,timestamp:s.tagger.timestamp,timezone:s.tagger.timezone},message:s.message,messageBytes:s.messageBytes,object:{oid:s.object.oid},planId:s.planId}),
  invalidCode:'vcs/tag-create-confirmation-invalid',unknownCode:'vcs/tag-create-outcome-unknown',
  unknownMessage:'Tag creation started but its final result is unknown. Objects or refs may exist. Refresh and inspect refs and HEAD. Never retry automatically, delete objects or refs, or roll back.'});
 return {async prepare(address,binding){return coordinator.prepare(capture(address),binding);},confirm:(address,binding)=>coordinator.confirm(address,binding),invalidate:entry=>coordinator.invalidate(entry),clear:()=>coordinator.clear()};
}
