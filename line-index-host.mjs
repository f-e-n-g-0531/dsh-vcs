import {randomBytes} from 'node:crypto';
import {createConfirmedOperationCoordinator} from './confirmed-operation.mjs';

// Direction is selected only by these fixed host factories, never client input.
export function createLineStageCoordinator(options){return createLineCoordinator(options,'stage');}
export function createLineUnstageCoordinator(options){return createLineCoordinator(options,'unstage');}

// Host owns read access around plan/prepare; only confirmation acquires a lock.
function createLineCoordinator({api,now=Date.now,ttlMs=60000,maxTokens=32},direction){
 const suffix=direction==='stage'?'Stage':'Unstage',action='line-'+direction;
 const plans=new Map();
 const invalid=()=>Object.assign(new Error('Line '+direction+' plan is expired, used, invalid, or belongs to a different Session/repository. Plan again.'),{code:'vcs/index-confirmation-invalid'});
 const purge=()=>{const time=now();for(const [token,row]of plans)if(row.expiresAt<=time)plans.delete(token);};
 const confirmation=createConfirmedOperationCoordinator({
  operationKind:'line-index-'+direction,now,ttlMs,maxTokens,
  prepare:(repository,{address,signal})=>{
   purge();const row=plans.get(address.planToken);plans.delete(address.planToken);
   const {entry,repository:identity,cwd}=address.binding;
   if(!row||row.entry!==entry||row.repository!==identity||row.cwd!==cwd||row.sessionId!==address.sessionId||row.repositoryId!==address.repositoryId)throw invalid();
   // Burn first. Validate the exact line-model array schema and copy own data
   // before any await, without evaluating accessors or accepting inherited IDs.
   const source=address.operationIds;
   if(!Array.isArray(source)||Object.getPrototypeOf(source)!==Array.prototype)throw invalid();
   const length=Object.getOwnPropertyDescriptor(source,'length').value;
   if(!length||length>8000||length>row.snapshot.plan.operations.length||Reflect.ownKeys(source).length!==length+1)throw invalid();
   const known=new Set(row.snapshot.plan.operations.map(operation=>operation.id)),seen=new Set(),ids=[];
   for(let i=0;i<length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(source,String(i));
    if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable||typeof descriptor.value!=='string'||!known.has(descriptor.value)||seen.has(descriptor.value))throw invalid();
    seen.add(descriptor.value);ids.push(descriptor.value);
   }
   return api['selectLineIndex'+suffix](repository,{snapshot:row.snapshot,operationIds:Object.freeze(ids),signal});
  },
  execute:(repository,request)=>api['applyLineIndex'+suffix](repository,request),
  project:snapshot=>({action,path:snapshot.path,head:snapshot.head,index:snapshot.index,target:snapshot.target,planId:snapshot.planId,operationIds:[...snapshot.operationIds]}),
  invalidCode:'vcs/index-confirmation-invalid',
  unknownCode:'vcs/index-outcome-unknown',
  unknownMessage:'Line '+(direction==='stage'?'staging':'unstaging')+' started but its final result could not be confirmed. Append-only object writes may remain even if the index was not updated. Refresh the repository and inspect the index before preparing another '+direction+'.',
 });
 return {
  async plan(address,{entry,repository,cwd,signal,assertAuthorized}){
   const {sessionId,repositoryId,id}=address;
   const snapshot=await api['prepareLineIndex'+suffix]({...repository},{id,signal});
   await assertAuthorized();signal?.throwIfAborted();purge();
   while(plans.size>=maxTokens)plans.delete(plans.keys().next().value);
   const planToken=randomBytes(32).toString('hex'),expiresAt=now()+ttlMs;
   plans.set(planToken,{snapshot,expiresAt,entry,repository,cwd,sessionId,repositoryId});
   return {action,path:snapshot.path,head:snapshot.head,index:snapshot.index,plan:snapshot.plan,planToken,expiresAt};
  },
  prepare(address,binding){
   const captured={...binding};
   return confirmation.prepare({sessionId:address.sessionId,repositoryId:address.repositoryId,planToken:address.planToken,operationIds:address.operationIds,binding:captured},captured);
  },
  confirm:(address,binding)=>confirmation.confirm(address,binding),
  invalidate(entry){for(const [token,row]of plans)if(row.entry===entry)plans.delete(token);confirmation.invalidate(entry);},
  clear(){plans.clear();confirmation.clear();},
 };
}
