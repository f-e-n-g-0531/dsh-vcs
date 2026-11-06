import {createConfirmedOperationCoordinator} from './confirmed-operation.mjs';

// Internal host adapter, not an authorization layer: callers must supply the
// authenticated binding and assertAuthorized callback required by the coordinator.
// address.path is host-resolved. A future RPC MUST NOT expose arbitrary paths;
// it must resolve an authorized repository entry before calling this wrapper.
export function createIndexUnstageCoordinator({api,now=Date.now,ttlMs=60000,maxTokens=32}){
 return createConfirmedOperationCoordinator({
  operationKind:'index-unstage',now,ttlMs,maxTokens,
  prepare:(repository,{address,signal})=>api.prepareIndexUnstage(repository,{path:address.path,signal}),
  execute:(repository,request)=>api.applyIndexUnstage(repository,request),
  // These are adapter-owned safe summaries, not the private fingerprint, raw
  // index bytes or metadata digests. head may be an object or an oid.
  project:snapshot=>({action:'unstage',path:snapshot.path,head:snapshot.head,index:snapshot.index,target:snapshot.target}),
  invalidCode:'vcs/index-confirmation-invalid',
  unknownCode:'vcs/index-outcome-unknown',
  unknownMessage:'Unstaging started but its final result could not be confirmed. Refresh the repository and inspect the index before preparing another unstage.',
 });
}
