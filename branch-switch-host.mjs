// Branch-specific adapter: the browser cannot choose the confirmed operation.
import {createConfirmedOperationCoordinator} from './confirmed-operation.mjs';
export {acquireRepositoryAccess} from './confirmed-operation.mjs';
export function createBranchSwitchCoordinator({api,now=Date.now,ttlMs=60000,maxTokens=32}){
 return createConfirmedOperationCoordinator({
  operationKind:'branch-switch',now,ttlMs,maxTokens,
  prepare:(repository,{address,signal})=>api.prepareLocalBranchSwitch(repository,{branch:address.branch,signal}),
  execute:(repository,request)=>api.switchLocalBranch(repository,request),
  project:snapshot=>({current:snapshot.current,target:snapshot.target}),
  invalidCode:'vcs/branch-confirmation-invalid',
  invalidMessage:'Confirmation is expired, used, or belongs to a different Session/repository. Prepare again.',
  unknownCode:'vcs/branch-outcome-unknown',
  unknownMessage:'Branch switching started but its final result could not be confirmed. Refresh the repository and inspect the current branch before preparing another switch.',
 });
}
