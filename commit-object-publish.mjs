import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {storeCapturedObject} from './git-object-store.mjs';
import {buildIndexTree} from './src/index-tree.mjs';
import {encodeGitTree} from './src/git-commit-object.mjs';
import {parseVerifiedCommit} from './src/verified-commit.mjs';
import {withOperationBudget, currentOperationBudget} from './src/operation-budget.mjs';

const MAX_TREES=100001, MAX_TREE_BYTES=8*1024*1024, MAX_COMMIT_BYTES=128*1024;
const invalid=message=>Object.assign(new Error(message),{code:'vcs/commit-objects-invalid'});
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function record(value,allowed,required=allowed){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalid('Expected own-data record.');
 const descriptors=Object.getOwnPropertyDescriptors(value), out=Object.create(null);
 for(const key of Reflect.ownKeys(descriptors)){
  const d=descriptors[key];
  if(typeof key!=='string'||!allowed.includes(key)||!Object.hasOwn(d,'value'))throw invalid('Unexpected field or accessor.');
  out[key]=d.value;
 }
 for(const key of required)if(!Object.hasOwn(out,key))throw invalid('Missing '+key+'.');
 return out;
}
function capture(input){
 const options=record(input,['gitDirectory','objectFormat','trees','commit','signal','assertAuthorized','onStart'],['gitDirectory','objectFormat','trees','commit','assertAuthorized','onStart']);
 const list=options.trees;
 if(!Array.isArray(list)||Object.getPrototypeOf(list)!==Array.prototype)throw invalid('trees must be an array.');
 const length=Object.getOwnPropertyDescriptor(list,'length').value;
 if(length<1||length>MAX_TREES)throw invalid('Tree count bound exceeded.');
 const keys=Reflect.ownKeys(list);
 if(keys.length!==length+1)throw invalid('Sparse or extended tree array.');
 const trees=[];let total=0;
 for(let i=0;i<length;i++){
  const descriptor=Object.getOwnPropertyDescriptor(list,String(i));
  if(!descriptor||!Object.hasOwn(descriptor,'value'))throw invalid('Tree array accessors are forbidden.');
  const tree=record(descriptor.value,['path','oid','body']);
  if(!Buffer.isBuffer(tree.body)||tree.body.length>MAX_TREE_BYTES||(total+=tree.body.length)>MAX_TREE_BYTES)throw invalid('Aggregate tree body bound exceeded.');
  trees.push({...tree,body:Buffer.from(tree.body)});
 }
 const commit=record(options.commit,['oid','body']);
 if(!Buffer.isBuffer(commit.body)||commit.body.length>MAX_COMMIT_BYTES)throw invalid('Commit body bound exceeded.');
 return {...options,trees,commit:{...commit,body:Buffer.from(commit.body)}};
}
function validate({objectFormat,trees,commit}){
 if(objectFormat!=='sha1'&&objectFormat!=='sha256')throw invalid('Unsupported object format.');
 const width=objectFormat==='sha1'?40:64, byPath=new Map(),used=new Set(),leaves=[];
 const verify=(type,{oid,body})=>{
  if(typeof oid!=='string'||oid.length!==width||/[^0-9a-f]/.test(oid)||/^0+$/.test(oid))throw invalid('Invalid full object id.');
  if(createHash(objectFormat).update(type+' '+body.length+'\0').update(body).digest('hex')!==oid)throw invalid('Object id mismatch.');
 };
 for(let i=0;i<trees.length;i++){
  const tree=trees[i];verify('tree',tree);
  if(typeof tree.path!=='string'||tree.path.length>4096||byPath.has(tree.path)||(tree.path==='')!==(i===trees.length-1))throw invalid('Invalid tree path, root or order.');
  const entries=[];let offset=0;
  while(offset<tree.body.length){
   if(entries.length===100000)throw invalid('Tree record bound exceeded.');
   const space=tree.body.indexOf(32,offset),nul=tree.body.indexOf(0,offset);
   if(space<offset||space-offset>6||nul<space+2||nul-space-1>4096||nul+1+width/2>tree.body.length)throw invalid('Malformed tree record.');
   const mode=tree.body.toString('ascii',offset,space);
   if(!['100644','100755','40000'].includes(mode))throw invalid('Noncanonical tree mode.');
   const name=utf8.decode(tree.body.subarray(space+1,nul));
   const oid=tree.body.subarray(nul+1,nul+1+width/2).toString('hex');
   const childPath=tree.path?tree.path+'/'+name:name;
   if(mode==='40000'){
    const child=byPath.get(childPath);
    if(!child||child.oid!==oid||used.has(childPath))throw invalid('Missing, reused or out-of-order child tree.');
    used.add(childPath);
   }else{
    if(leaves.length===100000)throw invalid('Leaf count bound exceeded.');
    leaves.push({path:childPath,mode,oid});
   }
   entries.push({name,mode,oid});offset=nul+1+width/2;
  }
  if(!encodeGitTree(entries,{objectFormat}).body.equals(tree.body))throw invalid('Noncanonical raw tree ordering or encoding.');
  byPath.set(tree.path,tree);
 }
 if(used.size!==trees.length-1)throw invalid('Unused tree.');
 const rebuilt=buildIndexTree(leaves,{objectFormat});
 if(rebuilt.trees.length!==trees.length||rebuilt.trees.some((t,i)=>t.path!==trees[i].path||t.oid!==trees[i].oid||!t.body.equals(trees[i].body)))throw invalid('Tree graph differs from canonical index graph.');
 verify('commit',commit);
 if(parseVerifiedCommit(commit.body,{oid:commit.oid,objectFormat}).tree!==rebuilt.root)throw invalid('Commit tree differs from root.');
 return rebuilt.root;
}

/** Append-only, child-first tree/commit publication; never touches refs or index.
 * All own-data inputs and ALL bodies are captured before callbacks/awaits. A single
 * 15s budget covers the operation (and inherits any shorter enclosing budget).
 * onStart must be synchronous; it runs once immediately before the store's first
 * mutation attempt, never when every object already exists (read-only success).
 * After onStart any failure is outcome-unknown: objects may remain, with no rollback.
 * Blob existence/type and parent existence are the CALLER's responsibility. Graph
 * validation does not consult or authenticate external blob/parent objects.
 */
export async function publishCommitObjects(input){
 const captured=capture(input);
 const {gitDirectory,objectFormat,trees,commit,signal,assertAuthorized,onStart}=captured;
 if(typeof assertAuthorized!=='function'||typeof onStart!=='function')throw invalid('Authorization and synchronous start callbacks required.');
 let started=false;
 try{
  return await withOperationBudget({signal,timeoutMs:15000},async()=>{
   const tree=validate(captured);
   const check=()=>currentOperationBudget().throwIfExpired();
   const authorize=async()=>{check();await assertAuthorized();check();};
   const start=()=>{
    if(started)return;
    started=true;
    const value=onStart();
    if(value&&typeof value.then==='function'){Promise.resolve(value).catch(()=>{});throw invalid('onStart must be synchronous.');}
   };
   const created=[];
   for(const [type,object] of [...trees.map(t=>['tree',t]),['commit',commit]]){
    await authorize();
    const stored=await storeCapturedObject({gitDirectory,objectFormat,type,bytes:object.body,signal:currentOperationBudget().signal,assertAuthorized:authorize,onStart:start});
    await authorize();
    if(stored.oid!==object.oid)throw invalid('Stored object id mismatch.');
    if(stored.created)created.push({type,oid:stored.oid});
   }
   return {tree,commit:commit.oid,created};
  });
 }catch(cause){
  if(!started)throw cause;
  throw Object.assign(new Error('Append-only commit object publication started; objects may exist. Never roll back by deletion.',{cause}),{code:'vcs/commit-objects-outcome-unknown',appendOnly:true,outcomeUnknown:true});
 }
}
