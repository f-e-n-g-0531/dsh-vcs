import {validateSvnCommand} from './svn-command-gate.mjs';
import {previousSvnRevision} from './svn-revision.mjs';
import {planSvnComparison} from './svn-comparison-plan.mjs';import {parseSvnPropertyNames} from './svn-property-names.mjs';import {svnHistoryTarget} from './svn-target.mjs';
import {createHash} from 'node:crypto';import {parseSvnDetail} from './svn-detail.mjs';
import {createSvnConsent} from './svn-consent.mjs';import {planSvnLog,planSvnDetail} from './svn-log-plan.mjs';import {parseSvnLogPage} from './svn-log.mjs';
// Internal coordinator only. Production remote transport is deliberately not provided.
export function createSvnRuntime({resolveIdentity,transport,now=Date.now,timeoutMs=15000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw Error('Invalid SVN runtime deadline');
 if(typeof resolveIdentity!=='function')throw Error('Local identity resolver required');const offers=createSvnConsent({now}),grants=createSvnConsent({now,onRevoke:token=>cancelToken(token)});
 const resolve=async(address,signal)=>{signal?.throwIfAborted();const local=await resolveIdentity(address,signal);signal?.throwIfAborted();return {...local,sessionId:address.sessionId,cwd:local.cwd,repositoryId:address.repositoryId};};
 const inFlight=new Map();
 const cancelToken=token=>{for(const task of inFlight.get(token)||[])task.controller.abort(new DOMException('SVN consent revoked','AbortError'));};
 const dispatch=async(plan,options)=>{
  validateSvnCommand(plan,options.identity);
  options.signal?.throwIfAborted();grants.assert(options.token,options.identity);const controller=new AbortController(),abort=()=>controller.abort(options.signal.reason);options.signal?.addEventListener('abort',abort,{once:true});
  const task={controller,sessionId:options.identity.sessionId};if(!inFlight.has(options.token))inFlight.set(options.token,new Set());inFlight.get(options.token).add(task);
  const timer=setTimeout(()=>controller.abort(new DOMException('SVN transport deadline exceeded','TimeoutError')),timeoutMs);
  try{const assertAuthorized=async()=>{controller.signal.throwIfAborted();const current=await resolve({sessionId:options.identity.sessionId,repositoryId:options.identity.repositoryId},controller.signal);grants.assert(options.token,current);controller.signal.throwIfAborted();};const value=await transport(plan,{...options,timeoutMs,signal:controller.signal,assertAuthorized});controller.signal.throwIfAborted();
  if(!(typeof value==='string'||Buffer.isBuffer(value))||Buffer.byteLength(value)>options.maxBytes)throw Error('SVN transport output exceeds byte limit or has invalid type');if(Buffer.isBuffer(value)&&plan.args[0]!=='cat')return new TextDecoder('utf-8',{fatal:true}).decode(value);return value;}catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw error;}finally{const tasks=inFlight.get(options.token);tasks?.delete(task);if(!tasks?.size)inFlight.delete(options.token);clearTimeout(timer);options.signal?.removeEventListener('abort',abort);}
 };
 const runtime={
 async describe(address,{signal}={}){const identity=await resolve(address,signal),offer=offers.grant(identity,{explicit:true});return {offer,root:identity.root,uuid:identity.uuid,scope:identity.scope,origin:new URL(identity.root).origin,expiresAt:now()+300000,remoteEnabled:typeof transport==='function'};},
 async approve(address,{offer,explicit=false,signal}={}){if(explicit!==true)throw Error('Explicit SVN network consent required');const identity=await resolve(address,signal);offers.assert(offer,identity);if(typeof transport!=='function')throw Error('SVN remote transport disabled');const token=grants.grant(identity,{explicit:true});offers.revoke(offer);return {token,expiresAt:now()+300000};},
 async log(address,{token,snapshot,cursor,limit,path,signal}={}){const identity=await resolve(address,signal);grants.assert(token,identity);if(typeof transport!=='function')throw Error('SVN remote transport disabled');const plan=planSvnLog({...identity,snapshot,cursor,limit,path});signal?.throwIfAborted();const xml=await dispatch(plan,{identity,token,signal,maxBytes:2097152,timeoutMs:15000});signal?.throwIfAborted();const after=await resolve(address,signal);grants.assert(token,after);return parseSvnLogPage(xml,plan);},
 async detail(address,{token,snapshot,revision,signal}={}){const identity=await resolve(address,signal);grants.assert(token,identity);if(typeof transport!=='function')throw Error('SVN remote transport disabled');const plan=planSvnDetail({...identity,snapshot,revision});const xml=await dispatch(plan,{identity,token,signal,maxBytes:2097152,timeoutMs:15000});signal?.throwIfAborted();grants.assert(token,await resolve(address,signal));const detail=parseSvnDetail(xml,plan);return {...detail,snapshot,changes:detail.changes.map(change=>({...change,id:createHash('sha256').update(JSON.stringify([identity.root,identity.uuid,identity.scope,snapshot,revision,change])).digest('hex')}))};},
 async compare(address,{token,snapshot,revision,id,signal}={}){
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid SVN change ID');const detail=await runtime.detail(address,{token,snapshot,revision,signal}),member=detail.changes.find(change=>change.id===id);if(!member)throw Error('SVN change is not selected revision member');
  const identity=await resolve(address,signal);grants.assert(token,identity);const plan=planSvnComparison(detail.changes.map(({id,...change})=>change),{scope:identity.scope,revision,path:member.path});
  const read=async(side)=>{if(side.empty)return {label:'empty',text:'',absent:true};const current=await resolve(address,signal);grants.assert(token,current);const target=svnHistoryTarget(current.root,side.path,side.pegRevision),options={identity:current,token,signal,maxBytes:2097152,timeoutMs:15000};
   const properties=await dispatch({args:['proplist','--xml','--non-interactive','--no-auth-cache','-r',side.revision,'--',target]},options);signal?.throwIfAborted();grants.assert(token,await resolve(address,signal));if(parseSvnPropertyNames(properties,{target:target.slice(0,target.lastIndexOf('@')),allowEmpty:true}).special)throw Error('SVN special files cannot be compared');
   const bytes=await dispatch({args:['cat','--non-interactive','--no-auth-cache','-r',side.revision,'--',target]},options);signal?.throwIfAborted();grants.assert(token,await resolve(address,signal));const buffer=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);if(buffer.length>2097152)throw Error('SVN text exceeds 2 MiB');if(buffer.includes(0))return {label:'r'+side.revision,text:'',binary:true};let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{return {label:'r'+side.revision,text:'',binary:true};}return {label:'r'+side.revision,text};};
  const left=await read(plan.left),right=await read(plan.right);return {path:member.path,revision,snapshot,left,right,binary:!!(left.binary||right.binary)};
 },
 async trace(address,{token,snapshot,revision,id,cursor,limit=50,signal}={}){
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw Error('Invalid SVN change ID');const detail=await runtime.detail(address,{token,snapshot,revision,signal}),member=detail.changes.find(change=>change.id===id);if(!member||member.kind!=='file')throw Error('SVN tracing requires selected file member');
  const peg=member.action==='D'?previousSvnRevision(revision):revision;const page=await runtime.log(address,{token,snapshot:peg,cursor:cursor??peg,limit,path:member.path,signal});return {...page,selectionSnapshot:snapshot,selectionRevision:revision,path:member.path,pegRevision:peg,stopOnCopy:true,copySourceOutsideScope:!!member.copySourceOutsideScope};
 },
 async revoke(address,{token,signal}={}){const identity=await resolve(address,signal);grants.assert(token,identity);grants.revoke(token);cancelToken(token);return {revoked:true};},
 revokeSession(sessionId){offers.revokeSession(sessionId);grants.revokeSession(sessionId);for(const [token,tasks] of inFlight)if([...tasks].some(task=>task.sessionId===sessionId))cancelToken(token);}
 };return runtime;
}
