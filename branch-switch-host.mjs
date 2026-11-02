// Server-owned, single-use confirmation and cooperative repository exclusion.
import {randomBytes} from 'node:crypto';
import path from 'node:path';
const access=new Map();
const error=(code,message)=>Object.assign(new Error(message),{code});
const keyOf=root=>{const key=path.resolve(root);return process.platform==='win32'?key.toLowerCase():key;};
export function acquireRepositoryAccess(root,write=false){
 const key=keyOf(root),state=access.get(key)||{readers:0,writer:false};
 if(state.writer||(write&&state.readers))throw error('vcs/busy','This repository has an active operation. Wait for it to finish and prepare again.');
 if(write)state.writer=true;else state.readers++;access.set(key,state);let released=false;
 return()=>{if(released)return;released=true;if(write)state.writer=false;else state.readers--;if(!state.writer&&!state.readers)access.delete(key);};
}
export function createBranchSwitchCoordinator({api,now=Date.now,ttlMs=60000,maxTokens=32}){
 const tokens=new Map();
 const purge=()=>{for(const [token,row]of tokens)if(row.expiresAt<=now())tokens.delete(token);};
 return {
  invalidate(entry){for(const [token,row]of tokens)if(row.entry===entry)tokens.delete(token);},
  clear(){tokens.clear();},
  async prepare(address,{entry,repository,cwd,signal,assertAuthorized}){
   const snapshot=await api.prepareLocalBranchSwitch({...repository},{branch:address.branch,signal});await assertAuthorized();signal?.throwIfAborted();purge();
   while(tokens.size>=maxTokens)tokens.delete(tokens.keys().next().value);
   const token=randomBytes(32).toString('hex'),expiresAt=now()+ttlMs;
   tokens.set(token,{snapshot,expiresAt,entry,repository,cwd,sessionId:address.sessionId,repositoryId:address.repositoryId});
   return {token,expiresAt,current:snapshot.current,target:snapshot.target};
  },
  async confirm(address,{entry,repository,cwd,signal,assertAuthorized}){
   purge();const row=tokens.get(address.token);tokens.delete(address.token);
   if(!row||row.entry!==entry||row.repository!==repository||row.cwd!==cwd||row.sessionId!==address.sessionId||row.repositoryId!==address.repositoryId)throw error('vcs/branch-confirmation-invalid','Confirmation is expired, used, or belongs to a different Session/repository. Prepare again.');
   const release=acquireRepositoryAccess(repository.root,true);let started=false;
   try{await assertAuthorized();signal?.throwIfAborted();const result=await api.switchLocalBranch({...repository},{snapshot:row.snapshot,signal,assertAuthorized,onStart(){started=true;}});await assertAuthorized();signal?.throwIfAborted();return result;}
   catch(failure){if(started)throw error('vcs/branch-outcome-unknown','Branch switching started but its final result could not be confirmed. Refresh the repository and inspect the current branch before preparing another switch.');throw failure;}
   finally{release();}
  },
 };
}
