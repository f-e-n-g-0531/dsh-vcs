// Server-owned, single-use confirmation and process-shared repository exclusion.
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

// operationKind and callbacks are selected by the host, never by a browser address.
// prepare(repository, {address, signal}) retains its entire result on the server.
// Only explicitly projected public fields cross the confirmation boundary.
export function createConfirmedOperationCoordinator({
 operationKind,api,prepare=api?.prepare,execute=api?.execute,project=()=>({}),
 now=Date.now,ttlMs=60000,maxTokens=32,
 invalidCode='vcs/confirmation-invalid',
 invalidMessage='Confirmation is expired, used, or belongs to a different Session/repository. Prepare again.',
 unknownCode='vcs/outcome-unknown',
 unknownMessage='The operation started but its final result could not be confirmed. Refresh the repository before preparing another operation.',
}){
 if(typeof operationKind!=='string'||!operationKind.trim())throw new TypeError('A server-selected operationKind is required.');
 if(typeof prepare!=='function'||typeof execute!=='function'||typeof project!=='function')throw new TypeError('Confirmation prepare, execute and project callbacks must be functions.');
 if(!Number.isFinite(ttlMs)||ttlMs<=0||!Number.isSafeInteger(maxTokens)||maxTokens<=0)throw new TypeError('Confirmation ttlMs and maxTokens must be positive.');
 const tokens=new Map();
 const purge=()=>{for(const [token,row]of tokens)if(row.expiresAt<=now())tokens.delete(token);};
 return {
  invalidate(entry){for(const [token,row]of tokens)if(row.entry===entry)tokens.delete(token);},
  clear(){tokens.clear();},
  async prepare(address,{entry,repository,cwd,signal,assertAuthorized}){
   const snapshot=await prepare.call(api,{...repository},{address,signal});await assertAuthorized();signal?.throwIfAborted();purge();
   while(tokens.size>=maxTokens)tokens.delete(tokens.keys().next().value);
   const token=randomBytes(32).toString('hex'),expiresAt=now()+ttlMs;
   const publicFields=project(snapshot);
   tokens.set(token,{snapshot,expiresAt,entry,repository,cwd,sessionId:address.sessionId,repositoryId:address.repositoryId,operationKind});
   return {...publicFields,token,expiresAt};
  },
  async confirm(address,{entry,repository,cwd,signal,assertAuthorized}){
   purge();const row=tokens.get(address.token);tokens.delete(address.token);
   if(!row||row.operationKind!==operationKind||row.entry!==entry||row.repository!==repository||row.cwd!==cwd||row.sessionId!==address.sessionId||row.repositoryId!==address.repositoryId)throw error(invalidCode,invalidMessage);
   const release=acquireRepositoryAccess(repository.root,true);let started=false;
   try{await assertAuthorized();signal?.throwIfAborted();const result=await execute.call(api,{...repository},{snapshot:row.snapshot,signal,assertAuthorized,onStart(){started=true;}});await assertAuthorized();signal?.throwIfAborted();return result;}
   catch(failure){if(started)throw error(unknownCode,unknownMessage);throw failure;}
   finally{release();}
  },
 };
}
