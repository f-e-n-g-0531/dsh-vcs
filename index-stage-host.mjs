import {createConfirmedOperationCoordinator} from './confirmed-operation.mjs';

// Internal host adapter, not an authorization layer: callers must supply the
// authenticated binding and assertAuthorized callback required by the coordinator.
// address.path is host-resolved. A future ID-only RPC facade must resolve an
// authorized repository entry before calling this wrapper, never accept raw paths.
export function createIndexStageCoordinator({api,now=Date.now,ttlMs=60000,maxTokens=32}){
 return createConfirmedOperationCoordinator({
  operationKind:'index-stage',now,ttlMs,maxTokens,
  prepare:(repository,{address,signal})=>api.prepareIndexStage(repository,{path:address.path,signal}),
  execute:(repository,request)=>api.applyIndexStage(repository,request),
  // Adapter-owned safe summaries only: retain the complete private snapshot on
  // the server, including captured bytes and fingerprints, for exact execution.
  project:snapshot=>({action:'stage',path:snapshot.path,head:snapshot.head,index:snapshot.index,target:snapshot.target}),
  invalidCode:'vcs/index-confirmation-invalid',
  unknownCode:'vcs/index-outcome-unknown',
  unknownMessage:'Staging started but its final result could not be confirmed. Append-only object writes may remain even if the index was not updated. Refresh the repository and inspect the index before preparing another stage.',
 });
}
