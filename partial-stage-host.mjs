import {randomBytes} from 'node:crypto';
import {createConfirmedOperationCoordinator} from './confirmed-operation.mjs';

// Internal adapter: the host resolves ID-only addresses, supplies authenticated
// bindings, and holds read access around plan/prepare. Only confirm takes a lock.
export function createPartialStageCoordinator({api,now=Date.now,ttlMs=60000,maxTokens=32}){
 const plans=new Map();
 const invalid=()=>Object.assign(new Error('Partial stage plan is expired, used, or belongs to a different Session/repository. Plan again.'),{code:'vcs/index-confirmation-invalid'});
 const purge=()=>{const time=now();for(const [token,row]of plans)if(row.expiresAt<=time)plans.delete(token);};
 const confirmation=createConfirmedOperationCoordinator({
  operationKind:'partial-index-stage',now,ttlMs,maxTokens,
  prepare:(repository,{address,signal})=>{
   purge();const row=plans.get(address.planToken);plans.delete(address.planToken);
   const {entry,repository:identity,cwd}=address.binding;
   if(!row||row.entry!==entry||row.repository!==identity||row.cwd!==cwd||row.sessionId!==address.sessionId||row.repositoryId!==address.repositoryId)throw invalid();
   // Consume before validation or selection, and capture data properties before
   // any await; neither the caller nor a deferred adapter can change the IDs.
   const source=address.unitIds;
   if(!Array.isArray(source)||!source.length||source.length>row.snapshot.plan.units.length)throw invalid();
   const ids=[];
   for(let i=0;i<source.length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(source,String(i));
    if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='string')throw invalid();
    ids.push(descriptor.value);
   }
   return api.selectPartialIndexStage(repository,{snapshot:row.snapshot,unitIds:Object.freeze(ids),signal});
  },
  execute:(repository,request)=>api.applyIndexStage(repository,request),
  project:snapshot=>({action:'partial-stage',path:snapshot.path,head:snapshot.head,index:snapshot.index,target:snapshot.target,planId:snapshot.planId,unitIds:[...snapshot.unitIds]}),
  invalidCode:'vcs/index-confirmation-invalid',
  unknownCode:'vcs/index-outcome-unknown',
  unknownMessage:'Partial staging started but its final result could not be confirmed. Append-only object writes may remain even if the index was not updated. Refresh the repository and inspect the index before preparing another stage.',
 });
 return {
  async plan(address,{entry,repository,cwd,signal,assertAuthorized}){
   const {sessionId,repositoryId,id}=address;
   const snapshot=await api.preparePartialIndexStage({...repository},{id,signal});
   await assertAuthorized();signal?.throwIfAborted();purge();
   while(plans.size>=maxTokens)plans.delete(plans.keys().next().value);
   const planToken=randomBytes(32).toString('hex'),expiresAt=now()+ttlMs;
   plans.set(planToken,{snapshot,expiresAt,entry,repository,cwd,sessionId,repositoryId});
   return {action:'partial-stage',path:snapshot.path,head:snapshot.head,index:snapshot.index,plan:snapshot.plan,planToken,expiresAt};
  },
  prepare(address,binding){
   const captured={...binding};
   return confirmation.prepare({sessionId:address.sessionId,repositoryId:address.repositoryId,planToken:address.planToken,unitIds:address.unitIds,binding:captured},captured);
  },
  confirm:(address,binding)=>confirmation.confirm(address,binding),
  invalidate(entry){for(const [token,row]of plans)if(row.entry===entry)plans.delete(token);confirmation.invalidate(entry);},
  clear(){plans.clear();confirmation.clear();},
 };
}
