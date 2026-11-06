// Internal server adapter only. A future host must resolve an authorized change ID;
// accepting a safe path here does NOT authorize a browser-supplied path.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {git} from './local-command.mjs';
import {parseGitIndex,replaceGitIndexEntry} from './src/git-index.mjs';
import {storeCapturedBlob} from './git-blob-store.mjs';
import {withOwnedIndexLock} from './index-lock.mjs';
import {currentOperationBudget} from './src/operation-budget.mjs';
import {createPartialIndexPlan,applyPartialIndexSelection,MAX_PARTIAL_INDEX_BYTES} from './src/partial-index.mjs';
import {createLineIndexPlan,applyLineIndexSelection} from './src/line-index.mjs';

const MAX_FILE=2*1024*1024, MAX_TOTAL=16*1024*1024, MAX_NODES=20000;
const issued=new WeakMap(), stagedIssued=new WeakMap(), partialIssued=new WeakMap(), partialUnstageIssued=new WeakMap(), unstagedPartialIssued=new WeakMap();
// LINE plans and candidates are never accepted by whole/BLOCK or opposite-direction APIs.
const lineStagePlans=new WeakMap(), lineUnstagePlans=new WeakMap(), lineStageIssued=new WeakMap(), lineUnstageIssued=new WeakMap();
const fail=(kind,message)=>Object.assign(new Error(message),{code:'vcs/index-'+kind});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value);
const check=signal=>{signal?.throwIfAborted();currentOperationBudget()?.throwIfExpired();};
const identity=s=>[s.dev,s.ino,s.birthtimeNs].map(String);
const version=s=>[...identity(s),s.size,s.mtimeNs,s.ctimeNs,s.mode].map(String);
const plain=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n;
const decode=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
// Join every launched read before exposing any result/error. Callers consume in
// the original validation order, not completion order (including synchronous throws).
async function settledReads(tasks){
  const results=await Promise.allSettled(tasks.map(task=>Promise.resolve().then(task)));
  return results.map(result=>()=>{if(result.status==='rejected')throw result.reason;return result.value;});
}
function safePath(value){
  if(typeof value!=='string'||!value||Buffer.byteLength(value)>4096||/[\u0000-\u001f\u007f\\:<>"|?*]/u.test(value))throw fail('unsafe','Unsafe exact repository path.');
  for(const part of value.split('/'))if(!part||part==='.'||part==='..'||part.toLowerCase()==='.git'||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))throw fail('unsafe','Unsafe exact repository path.');
  return value;
}
async function exists(file){try{await fs.lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function readPlain(file,max,signal){
  check(signal);const before=await fs.lstat(file,{bigint:true});
  if(!plain(before)||before.size>BigInt(max))throw fail('unsupported','Expected bounded single-link regular file: '+file);
  const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{
    const opened=await handle.stat({bigint:true});
    if(!plain(opened)||json(version(before))!==json(version(opened)))throw fail('stale','File changed while opening.');
    const buffer=Buffer.alloc(max+1);let length=0;
    while(length<buffer.length){check(signal);const {bytesRead}=await handle.read(buffer,length,buffer.length-length,length);if(!bytesRead)break;length+=bytesRead;}
    const after=await handle.stat({bigint:true}),current=await fs.lstat(file,{bigint:true});
    if(length>max||!plain(current)||json(version(opened))!==json(version(after))||json(version(after))!==json(version(current))||BigInt(length)!==after.size)throw fail('stale','File changed while reading.');
    return {bytes:Buffer.from(buffer.subarray(0,length)),identity:version(after)};
  }finally{await handle.close();}
}
// Check all metadata links/state before asking Git to inspect objects. Directory
// timestamps deliberately are NOT compared: creating our own lock changes them.
async function metadata(directory,allowLock,signal){
  const rows=[];let count=0;
  const forbidden=new Set(['commondir','gitdir','shallow','config.worktree','MERGE_HEAD','MERGE_MSG','CHERRY_PICK_HEAD','REVERT_HEAD','REBASE_HEAD','BISECT_LOG','BISECT_START','rebase-merge','rebase-apply','sequencer','info/sparse-checkout','info/attributes','objects/info/alternates','objects/info/http-alternates'].map(value=>value.toLowerCase()));
  async function visit(file,relative){
    check(signal);if(++count>MAX_NODES)throw fail('unsupported','Metadata inspection limit exceeded.');
    const guard=relative.toLowerCase(); // Conservative on every platform; preserves physical spelling below.
    if(guard==='index.lock'&&relative==='index.lock'&&allowLock)return; // only withOwnedIndexLock checks ownership
    if(forbidden.has(guard)||guard.endsWith('.lock')||guard.endsWith('.promisor'))throw fail('unsupported','Repository operation, lock or unsupported metadata: '+relative);
    if(guard.startsWith('hooks/')&&!guard.endsWith('.sample'))throw fail('unsupported','Active hooks are unsupported.');
    const s=await fs.lstat(file,{bigint:true});
    if(s.isSymbolicLink()||(!s.isDirectory()&&!plain(s))||await fs.realpath(file)!==file)throw fail('unsafe','Redirected or special metadata.');
    if(relative==='index')return;
    rows.push([relative,s.isDirectory()?identity(s):version(s)]);
    if(s.isDirectory())for(const name of (await fs.readdir(file)).sort())await visit(path.join(file,name),relative?relative+'/'+name:name);
  }
  await visit(directory,'');return rows;
}
async function workPaths(root,signal){
  const files=[],directories=[];let nodes=0;
  async function visit(dir,relative){
    check(signal);if(++nodes>MAX_NODES)throw fail('unsupported','Working tree inspection limit exceeded.');
    const s=await fs.lstat(dir,{bigint:true});
    if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(dir)!==dir)throw fail('unsafe','Working directories must be canonical.');
    directories.push([relative,identity(s)]);
    for(const name of (await fs.readdir(dir)).sort()){
      if(!relative&&name==='.git')continue;
      const rel=relative?relative+'/'+name:name;safePath(rel);
      if(name.toLowerCase()==='.gitattributes'||name.toLowerCase()==='.gitmodules')throw fail('unsupported','Attributes and submodules are unsupported.');
      const target=path.join(dir,name),stat=await fs.lstat(target,{bigint:true});
      if(stat.isDirectory()&&!stat.isSymbolicLink())await visit(target,rel);
      else {if(++nodes>MAX_NODES||!plain(stat))throw fail('unsupported','Links and special working files are unsupported.');files.push(rel);}
    }
  }
  await visit(root,'');return {files,directories};
}
// Never stored in snapshots/grants or accepted through public arguments. Ref syntax
// is pure and may be reused for the exact validated string within one public call.
// Fixed object reads require the complete metadata fingerprint (including every
// object file; excluding the separately checked Index) to remain equal.
async function capture(repo,selected,signal,{allowLock=false,published=false,id,operation='unstage',partialMM=false}={},context){
  check(signal);if(id===undefined)safePath(selected);
  else if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw fail('stale','Invalid staged selection ID.');
  if(repo?.type!=='git'||typeof repo.root!=='string'||!path.isAbsolute(repo.root))throw fail('unsupported','An absolute canonical Git root is required.');
  const root=path.resolve(repo.root);
  if(await fs.realpath(root)!==root)throw fail('unsafe','Repository root must be canonical.');
  const rootStat=await fs.lstat(root,{bigint:true}),directory=path.join(root,'.git');
  const metadataRows=await metadata(directory,allowLock,signal),metadataHash=hash(json(metadataRows));
  const run=(args,max=MAX_FILE)=>{check(signal);return git(root,args,max,{signal});};
  for(const file of [path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'),'git','attributes'),path.join(os.homedir(),'.gitattributes')])if(await exists(file))throw fail('unsupported','Global attributes are unsupported.');
  const config=await run(['config','--null','--list']);
  const configRows=new Map();
  for(const row of decode(config).split('\0').filter(Boolean))configRows.set(row.split('\n',1)[0].toLowerCase(),row);
  for(const row of configRows.values()){
    const split=row.indexOf('\n'),key=(split<0?row:row.slice(0,split)).toLowerCase(),value=split<0?'':row.slice(split+1).toLowerCase();
    if(key.startsWith('filter.')||key.startsWith('hook.')||key.startsWith('include')||key.startsWith('submodule.')||key.startsWith('extensions.')&&key!=='extensions.objectformat'||['core.worktree','core.hookspath','core.attributesfile','core.fsmonitor','core.sparsecheckout','core.sparsecheckoutcone','index.sparse','core.splitindex','core.untrackedcache','core.symlinks'].includes(key)&&!['false','no','0'].includes(value)||/^remote\..*\.(promisor|partialclonefilter)$/.test(key))throw fail('unsupported','Unsupported repository configuration: '+key);
    if(['core.autocrlf','core.safecrlf'].includes(key)&&!['false','no','0'].includes(value))throw fail('unsupported','Content conversions are unsupported.');
  }
  // Only read-only tasks overlap, after metadata/config guards. Mutable facts
  // stay fresh and their results are validated in the original order.
  const [readFacts,readIndex,readHead]=await settledReads([
    ()=>run(['rev-parse','--absolute-git-dir','--git-common-dir','--show-toplevel','--is-bare-repository','--show-object-format','--verify','HEAD^{commit}']),
    ()=>readPlain(path.join(directory,'index'),8*1024*1024,signal),
    ()=>readPlain(path.join(directory,'HEAD'),4096,signal)
  ]);
  let facts;try{facts=decode(readFacts()).split('\n');}catch(e){if(e.code==='VCS_COMMAND')throw fail('unsupported','Born HEAD in an embedded repository is required.');throw e;}
  if(facts.length!==7||facts[6]!==''||facts.slice(0,3).some(value=>!value||/[\r\0]/.test(value))||path.resolve(root,facts[0])!==directory||path.resolve(root,facts[1])!==directory||path.resolve(facts[2])!==root||facts[3]!=='false')throw fail('unsupported','Only embedded non-bare repositories are supported.');
  const objectFormat=facts[4],commit=facts[5];
  const index=readIndex();
  const parsed=parseGitIndex(index.bytes,{objectFormat});
  if(parsed.extensions.some(e=>!['TREE','EOIE','IEOT'].includes(e.signature)))throw fail('unsupported','Unsupported Index extension.');
  const headFile=readHead();
  const headText=decode(headFile.bytes);
  if(!/^ref: refs\/heads\/[^\r\n]+\n?$/.test(headText))throw fail('unsupported','Born symbolic HEAD is required.');
  const ref=headText.trim().slice(5);
  const objectKey=json([root,objectFormat,commit,metadataHash]);
  const [checkRef,readTree]=await settledReads([
    ()=>{check(signal);if(context.validatedRef===ref)return;return run(['check-ref-format',ref]);},
    async()=>{
      if(!['sha1','sha256'].includes(objectFormat)||!(objectFormat==='sha1'?/^[a-f0-9]{40}$/:/^[a-f0-9]{64}$/).test(commit))throw fail('unsupported','Invalid fixed HEAD object identity.');
      check(signal);
      if(context.key===objectKey&&context.headEntries)return context.headEntries;
      const tree=decode(await run(['ls-tree','-r','-z','--full-tree',commit],8*1024*1024)),entries=[];
      for(const row of tree.split('\0').filter(Boolean)){
        const match=/^(100644|100755) blob ([a-f0-9]{40}|[a-f0-9]{64})	(.+)$/.exec(row);
        if(!match)throw fail('unsupported','Special HEAD tree entries are unsupported.');
        safePath(match[3]);entries.push({path:match[3],oid:match[2],mode:match[1]});
      }
      return entries;
    }
  ]);
  // All siblings have settled before recording a successful syntax check. A
  // failed checker never warms the context; mutable HEAD/ref facts stay fresh.
  checkRef();context.validatedRef=ref;const headEntries=readTree();
  // Publish only complete successful results, never an in-flight/rejected read.
  if(context.key!==objectKey){context.key=objectKey;context.blob=undefined;}
  context.headEntries=headEntries;
  for(const entry of [...headEntries,...parsed.entries])if(entry.path.split('/').some(p=>['.gitattributes','.gitmodules'].includes(p.toLowerCase())))throw fail('unsupported','Tracked attributes/submodules are unsupported.');
  const folded=new Set();for(const entry of parsed.entries){const key=entry.path.toLowerCase();if(folded.has(key))throw fail('unsupported','Case-ambiguous paths are unsupported.');folded.add(key);}
  if(id!==undefined){
    const indexStatuses=partialMM&&operation==='stage'?[' ','M']:[operation==='stage'?' ':'M'];
    const workStatuses=operation==='stage'?['M']:partialMM?[' ','M']:[' '];
    const matches=parsed.entries.filter(entry=>indexStatuses.some(indexStatus=>workStatuses.some(workStatus=>createHash('sha256').update(json([operation==='stage'?'unstaged':'staged',entry.path,undefined,'modified',indexStatus,workStatus,undefined,undefined,undefined])).digest('hex')===id)));
    if(matches.length!==1)throw fail('stale','Staged selection changed; refresh.');
    selected=matches[0].path;
  }
  const selectedIndex=parsed.entries.find(e=>e.path===selected),head=headEntries.find(e=>e.path===selected);
  if(!selectedIndex||!head||!published&&(operation==='stage'?((!partialMM&&selectedIndex.oid!==head.oid)||selectedIndex.mode!==head.mode):(selectedIndex.oid===head.oid&&selectedIndex.mode===head.mode)))throw fail('unsupported','Select an existing tracked staged modified regular file.');
  if(partialMM&&selectedIndex.mode!==head.mode)throw fail('unsupported','Partial changes require unchanged regular file modes.');
  check(signal);
  const [readType,readAttributes]=await settledReads([
    async()=>{if(context.blob!==head.oid&&decode(await run(['cat-file','-t',head.oid])).trim()!=='blob')throw fail('unsupported','Pinned HEAD entry must resolve to an existing blob.');},
    // Also refuse implicit/system attributes, without invoking any content filter.
    ()=>run(['check-attr','--all','-z','--',selected])
  ]);
  readType();context.blob=head.oid;
  if(readAttributes().length)throw fail('unsupported','Selected path has Git attributes.');
  // No status or working bytes are inspected until config, state, flags, trees,
  // links and attributes have all been refused.
  const paths=await workPaths(root,signal);let total=0,capturedBytes;const work=[];
  for(const file of paths.files){const item=await readPlain(path.join(root,...file.split('/')),MAX_FILE,signal);total+=item.bytes.length;if(total>MAX_TOTAL)throw fail('unsupported','Working content exceeds 16MiB.');work.push({path:file,identity:item.identity,digest:hash(item.bytes)});
    if(file===selected){capturedBytes=item.bytes;}
    if(file===selected&&!published){const oid=createHash(objectFormat).update(Buffer.from('blob '+item.bytes.length+'\0')).update(item.bytes).digest('hex');if((operation==='stage'?oid===selectedIndex.oid:!partialMM&&oid!==selectedIndex.oid)||process.platform!=='win32'&&Boolean(Number(item.identity.at(-1))&0o111)!==(selectedIndex.mode==='100755'))throw fail('unsupported','Selected working bytes/mode must match the Index; partial staging is unsupported.');}
  }
  if(!work.some(e=>e.path===selected))throw fail('unsupported','Selected working file is missing.');
  // Resolve the exact existing vcs identity only after all capture guards. The
  // provisional lookup above permits locating attributes without running status.
  if(id!==undefined&&partialMM){
    const indexStatus=selectedIndex.oid===head.oid?' ':'M',workStatus=createHash(objectFormat).update(Buffer.from('blob '+capturedBytes.length+'\0')).update(capturedBytes).digest('hex')===selectedIndex.oid?' ':'M';
    const exact=createHash('sha256').update(json([operation==='stage'?'unstaged':'staged',selected,undefined,'modified',indexStatus,workStatus,undefined,undefined,undefined])).digest('hex');
    if(exact!==id)throw fail('stale','Exact selection changed; refresh.');
  }
  check(signal);
  return {root,directory,rootIdentity:identity(rootStat),metadataRows,metadataHash,config:hash(config),headFile:{identity:headFile.identity,digest:hash(headFile.bytes)},ref,commit,objectFormat,index:{identity:index.identity,digest:hash(index.bytes)},entries:parsed.entries,head,selected:selectedIndex,work,directories:paths.directories,bytes:index.bytes,capturedBytes};
}
const fingerprint=s=>hash(json({...s,bytes:undefined,capturedBytes:undefined}));
function candidate(state,selected){return replaceGitIndexEntry(state.bytes,{path:selected,expectedOid:state.selected.oid,expectedMode:state.selected.mode,oid:state.head.oid,mode:state.head.mode,objectFormat:state.objectFormat});}

/** Returns an opaque, process-local server snapshot (not JSON-round-trippable).
 * Bounds: Index 8MiB/100000 entries; <=20000 nodes per scan; each working file
 * <=2MiB, total <=16MiB (including ignored/untracked). Repeated FS checks and a
 * real index.lock are conservative CAS, NOT global filesystem atomicity.
 * Unsupported: additions/deletions, selected MM/partial staging or conversions,
 * detached/unborn HEAD, external/linked/bare metadata, operation state, locks,
 * attributes/filters/hooks, sparse/partial/split indexes, special entries/flags,
 * case aliases, symlinks/hardlinks anywhere scanned. Unrelated dirty files are OK.
 * RPC/UI use the guarded opaque-ID selector. Whole unstage never creates objects;
 * stage and internal partial unstage can append one exact raw candidate blob.
 */
export async function prepareSelectedIndexUnstage(repo,{id,signal}={}){
  return prepareIndexUnstage(repo,{id,signal});
}
export async function prepareIndexUnstage(repo,{path:selected,id,signal}={}){
  const context={};
  const state=await capture(repo,selected,signal,{id},context);selected=state.selected.path;candidate(state,selected);
  const again=await capture(repo,selected,signal,{},context);
  if(fingerprint(state)!==fingerprint(again))throw fail('stale','Repository changed during preparation.');
  const snapshot=Object.freeze({path:selected,head:state.commit,index:Object.freeze({oid:state.selected.oid,mode:state.selected.mode}),target:Object.freeze({oid:state.head.oid,mode:state.head.mode}),fingerprint:fingerprint(state)});
  issued.set(snapshot,{state,selected});return snapshot;
}
/** Publishes only a pure one-entry replacement; no Git mutation/object writes.
 * Returns {path, head:commitOID, index:{oid,mode}}. Every error after onStart
 * (including cancellation/authorization/deadline or verification) is outcome-unknown.
 */
export async function applyIndexUnstage(repo,{snapshot,signal,assertAuthorized,onStart}={}){
  const context={};let started=false;
  try{
    const saved=snapshot&&issued.get(snapshot);
    if(!saved||typeof assertAuthorized!=='function'||typeof onStart!=='function')throw fail('stale','A server-issued snapshot and authorization/start callbacks are required.');
    const {state,selected}=saved;check(signal);await assertAuthorized();check(signal);
    const revalidate=async()=>{const fresh=await capture(repo,selected,signal,{allowLock:true},context);if(fingerprint(fresh)!==fingerprint(state))throw fail('stale','Repository snapshot changed.');return fresh;};
    const fresh=await capture(repo,selected,signal,{},context);
    if(fingerprint(fresh)!==fingerprint(state))throw fail('stale','Repository snapshot changed.');
    const expected=candidate(state,selected);
    const result=await withOwnedIndexLock({gitDirectory:state.directory,expectedIndexDigest:state.index.digest,signal},async lock=>{
      const live=await lock.readIndex();if(!live.equals(state.bytes))throw fail('stale','Raw Index changed.');
      await lock.writeCandidate(expected);
      await lock.publish({assertAuthorized:async()=>{check(signal);await assertAuthorized();check(signal);if(!started)await revalidate();},beforePublish:async()=>{const current=await revalidate();if(!candidate(current,selected).equals(expected))throw fail('stale','Candidate changed.');},onStart:()=>{started=true;check(signal);return onStart();}});
      const after=await capture(repo,selected,signal,{published:true},context);
      const expectedEntries=parseGitIndex(expected,{objectFormat:state.objectFormat}).entries;
      if(!after.bytes.equals(expected)||json(after.entries)!==json(expectedEntries)||json(after.work)!==json(state.work)||json(after.directories)!==json(state.directories)||after.commit!==state.commit||after.ref!==state.ref||after.metadataHash!==state.metadataHash||after.config!==state.config||json(after.rootIdentity)!==json(state.rootIdentity)||json(after.headFile)!==json(state.headFile)||json(after.head)!==json(state.head))throw fail('stale','Post-publication verification failed.');
      await assertAuthorized();check(signal);
      return {path:selected,head:state.commit,index:{oid:state.head.oid,mode:state.head.mode}};
    });
    check(signal);return result;
  }catch(error){if(!started)throw error;throw Object.assign(fail('outcome-unknown','Index publication may have occurred; refresh state and do not retry blindly.'),{outcomeUnknown:true,cause:error});}
}

// Whole unstage, stage and reverse-partial grants have separate capability namespaces.
// Direction and MM policy are selected only by internal entry points/WeakMaps.
const stageCandidate=(state,selected,target)=>replaceGitIndexEntry(state.bytes,{path:selected,expectedOid:state.selected.oid,expectedMode:state.selected.mode,...target,objectFormat:state.objectFormat});
export async function prepareSelectedIndexStage(repo,{id,signal}={}){
  return prepareIndexStage(repo,{id,signal});
}
export async function prepareIndexStage(repo,{path:selected,id,signal}={}){
  const context={};
  const state=await capture(repo,selected,signal,{id,operation:'stage'},context);selected=state.selected.path;
  const bytes=Buffer.from(state.capturedBytes);
  const target=Object.freeze({oid:createHash(state.objectFormat).update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),mode:state.selected.mode});
  stageCandidate(state,selected,target);
  const again=await capture(repo,selected,signal,{operation:'stage'},context);
  if(fingerprint(state)!==fingerprint(again))throw fail('stale','Repository changed during preparation.');
  const snapshot=Object.freeze({path:selected,head:state.commit,index:Object.freeze({oid:state.selected.oid,mode:state.selected.mode}),target,fingerprint:fingerprint(state)});
  stagedIssued.set(snapshot,{state,selected,bytes,target});return snapshot;
}
/** Internal only: a process-local plan pins the ENTIRE repository capture.
 * Only partial plans permit selected MM; modes and all other guards stay pinned.
 * The model exposes frozen display data, never retained source/candidate buffers.
 */
export async function preparePartialIndexStage(repo,options={}){return preparePartialIndex(repo,options,'stage');}
export async function preparePartialIndexUnstage(repo,options={}){return preparePartialIndex(repo,options,'unstage');}
export async function prepareLineIndexStage(repo,options={}){return preparePartialIndex(repo,options,'stage',true);}
export async function prepareLineIndexUnstage(repo,options={}){return preparePartialIndex(repo,options,'unstage',true);}
async function preparePartialIndex(repo,{id,signal},operation,line=false){
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw fail('stale','An exact '+(operation==='stage'?'unstaged':'staged')+' selection ID is required.');
  const context={};
  const partialMM=true; // Private policy: never sourced from public arguments/snapshots.
  const state=await capture(repo,undefined,signal,{id,operation,partialMM},context),selected=state.selected.path;
  check(signal);
  // Fixed OID only: safe Git disables replacements, lazy fetch and inherited overrides.
  // Read one extra byte to reject rather than truncate at the exact model bound.
  const before=await git(state.root,['cat-file','blob',state.selected.oid],MAX_PARTIAL_INDEX_BYTES+1,{signal});
  check(signal);
  if(before.length>MAX_PARTIAL_INDEX_BYTES)throw fail('unsupported','Index blob exceeds 256KiB.');
  const oid=createHash(state.objectFormat).update(Buffer.from('blob '+before.length+'\0')).update(before).digest('hex');
  if(oid!==state.selected.oid)throw fail('stale','Fixed Index blob identity changed.');
  let after;
  if(operation==='unstage'){
    after=await git(state.root,['cat-file','blob',state.head.oid],MAX_PARTIAL_INDEX_BYTES+1,{signal});check(signal);
    if(after.length>MAX_PARTIAL_INDEX_BYTES)throw fail('unsupported','HEAD blob exceeds 256KiB.');
    if(createHash(state.objectFormat).update(Buffer.from('blob '+after.length+'\0')).update(after).digest('hex')!==state.head.oid)throw fail('stale','Fixed HEAD blob identity changed.');
  }else after=Buffer.from(state.capturedBytes);
  const plan=(line?createLineIndexPlan:createPartialIndexPlan)(before,after,{signal});
  if(!plan.units.length)throw fail('unsupported','Partial '+operation+' has no changes.');
  const again=await capture(repo,selected,signal,{operation,partialMM},context);
  if(fingerprint(state)!==fingerprint(again))throw fail('stale','Repository changed during preparation.');
  check(signal);
  const snapshot=Object.freeze({path:selected,head:state.commit,index:Object.freeze({oid:state.selected.oid,mode:state.selected.mode}),plan,fingerprint:fingerprint(state)});
  const grants=line?(operation==='stage'?lineStagePlans:lineUnstagePlans):(operation==='stage'?partialIssued:partialUnstageIssued);
  grants.set(snapshot,{state,selected,before:Buffer.from(before),after,plan,partialMM});return snapshot;
}
/** Single-use selection; only this exact frozen plan grant can issue a direction-specific grant.
 * Capture remains the original FULL work, while only private candidate bytes are
 * passed to the shared append-only publisher and its target postchecks.
 */
export async function selectPartialIndexStage(repo,options={}){return selectPartialIndex(repo,options,'stage');}
export async function selectPartialIndexUnstage(repo,options={}){return selectPartialIndex(repo,options,'unstage');}
async function selectPartialIndex(repo,{snapshot,unitIds,signal},operation){
  const grants=operation==='stage'?partialIssued:partialUnstageIssued;
  const saved=snapshot&&grants.get(snapshot);
  if(!saved)throw fail('stale','A server-issued partial plan snapshot is required.');
  grants.delete(snapshot);
  const {state,selected,before,after,plan,partialMM}=saved;
  check(signal);
  if(!Object.isFrozen(snapshot)||snapshot.plan!==plan||!Object.isFrozen(plan))throw fail('stale','Partial plan binding changed.');
  if(!Array.isArray(unitIds)||!unitIds.length||unitIds.length>plan.units.length)throw fail('invalid','Select nonempty unique known unit IDs.');
  // Copy before the first await; later caller edits cannot alter this selection.
  const ids=[];
  for(let i=0;i<unitIds.length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(unitIds,String(i));
    if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='string')throw fail('invalid','Invalid unit IDs.');
    ids.push(descriptor.value);
  }
  const known=new Set(plan.units.map(unit=>unit.id));
  if(new Set(ids).size!==ids.length||ids.some(id=>!known.has(id)))throw fail('invalid','Unknown or duplicate unit IDs.');
  const fresh=await capture(repo,selected,signal,{operation,partialMM},{});
  if(fingerprint(fresh)!==fingerprint(state))throw fail('stale','Repository snapshot changed.');
  const bytes=applyPartialIndexSelection(before,after,plan,ids,{signal});
  if(bytes.equals(before))throw fail('unsupported','Partial '+operation+' selection is a no-op.');
  const target=Object.freeze({oid:createHash(state.objectFormat).update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),mode:state.selected.mode});
  stageCandidate(state,selected,target);check(signal);
  const selectedIds=Object.freeze([...ids]);
  const result=Object.freeze({path:selected,head:state.commit,index:snapshot.index,target,planId:plan.id,unitIds:selectedIds,fingerprint:fingerprint(state)});
  (operation==='stage'?stagedIssued:unstagedPartialIssued).set(result,{state,selected,bytes,target,partialMM});return result;
}
/** LINE uses the same exact capture and publisher, but isolated capabilities. */
export async function selectLineIndexStage(repo,options={}){return selectLineIndex(repo,options,'stage');}
export async function selectLineIndexUnstage(repo,options={}){return selectLineIndex(repo,options,'unstage');}
async function selectLineIndex(repo,{snapshot,operationIds,signal},operation){
  const grants=operation==='stage'?lineStagePlans:lineUnstagePlans;
  const saved=snapshot&&grants.get(snapshot);
  if(!saved)throw fail('stale','A server-issued line plan snapshot is required.');
  grants.delete(snapshot); // Even a rejected selection consumes the plan.
  const {state,selected,before,after,plan,partialMM}=saved;
  check(signal);
  if(!Object.isFrozen(snapshot)||snapshot.plan!==plan||!Object.isFrozen(plan))throw fail('stale','Line plan binding changed.');
  if(!Array.isArray(operationIds)||Object.getPrototypeOf(operationIds)!==Array.prototype)throw fail('invalid','Select nonempty unique known operation IDs.');
  const length=Object.getOwnPropertyDescriptor(operationIds,'length').value;
  if(!length||length>plan.operations.length||Reflect.ownKeys(operationIds).length!==length+1)throw fail('invalid','Invalid operation IDs.');
  // Own data only, copied before the first await (never run caller getters).
  const ids=[],known=new Set(plan.operations.map(item=>item.id));
  for(let i=0;i<length;i++){
    const descriptor=Object.getOwnPropertyDescriptor(operationIds,String(i));
    if(!descriptor||!Object.hasOwn(descriptor,'value')||!descriptor.enumerable||typeof descriptor.value!=='string'||!known.has(descriptor.value))throw fail('invalid','Unknown operation ID.');
    ids.push(descriptor.value);
  }
  if(new Set(ids).size!==ids.length)throw fail('invalid','Duplicate operation IDs.');
  const fresh=await capture(repo,selected,signal,{operation,partialMM},{});
  if(fingerprint(fresh)!==fingerprint(state))throw fail('stale','Repository snapshot changed.');
  const bytes=applyLineIndexSelection(before,after,plan,ids,{signal});
  if(bytes.equals(before))throw fail('unsupported','Line '+operation+' selection is a no-op.');
  const target=Object.freeze({oid:createHash(state.objectFormat).update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),mode:state.selected.mode});
  stageCandidate(state,selected,target);check(signal);
  const result=Object.freeze({path:selected,head:state.commit,index:snapshot.index,target,planId:plan.id,operationIds:Object.freeze([...ids]),fingerprint:fingerprint(state)});
  (operation==='stage'?lineStageIssued:lineUnstageIssued).set(result,{state,selected,bytes,target,partialMM});return result;
}
export async function applyLineIndexStage(repo,options={}){return publishCapturedIndex(repo,options,lineStageIssued,'stage');}
export async function applyLineIndexUnstage(repo,options={}){return publishCapturedIndex(repo,options,lineUnstageIssued,'unstage');}
/** Append the captured raw blob, then publish a one-tuple Index CAS. After onStart,
 * any failure is unknown: an append-only object can remain even if Index is unchanged.
 * Same conservative bounds/configuration refusals as unstage. No rollback or GC.
 */
export async function applyIndexStage(repo,options={}){return publishCapturedIndex(repo,options,stagedIssued,'stage');}
export async function applyPartialIndexUnstage(repo,options={}){return publishCapturedIndex(repo,options,unstagedPartialIssued,'unstage');}
async function publishCapturedIndex(repo,{snapshot,signal,assertAuthorized,onStart},grants,operation){
  const context={};let started=false;
  const start=()=>{if(!started){started=true;check(signal);const result=onStart();if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw fail('invalid','onStart must be synchronous.');}}};
  try{
    const saved=snapshot&&grants.get(snapshot);
    if(!saved||typeof assertAuthorized!=='function'||typeof onStart!=='function')throw fail('stale','A server-issued '+operation+' snapshot and callbacks are required.');
    const {state,selected,bytes,target,partialMM=false}=saved;
    const authorize=async()=>{check(signal);await assertAuthorized();check(signal);};
    await authorize();
    let baseline=state;
    const revalidate=async(allowLock=true)=>{const fresh=await capture(repo,selected,signal,{allowLock,operation,partialMM},context);if(fingerprint(fresh)!==fingerprint(baseline))throw fail('stale','Repository snapshot changed.');return fresh;};
    await revalidate(false);
    const expected=stageCandidate(state,selected,target);
    const result=await withOwnedIndexLock({gitDirectory:state.directory,expectedIndexDigest:state.index.digest,signal},async lock=>{
      if(!(await lock.readIndex()).equals(state.bytes))throw fail('stale','Raw Index changed.');
      await revalidate();await authorize();await revalidate();
      // Do not capture metadata from store callbacks: the primitive temporarily owns
      // a temp path and a second hardlink. Inspect the complete tree after cleanup.
      const stored=await storeCapturedBlob({gitDirectory:state.directory,objectFormat:state.objectFormat,bytes,signal,assertAuthorized:authorize,onStart:start});
      if(stored.oid!==target.oid)throw fail('stale','Captured blob identity changed.');
      // Existing correct objects do not notify the store callback. Notify before
      // final full-state validation so callback mutations cannot evade the CAS.
      start();check(signal);
      const fresh=await capture(repo,selected,signal,{allowLock:true,operation,partialMM},context);
      const old=new Map(state.metadataRows),fanout='objects/'+target.oid.slice(0,2),object=fanout+'/'+target.oid.slice(2);
      const permitted=new Set(stored.created?[fanout,object]:[]);
      // Only absent exact target/fanout rows may be added. All old rows, including
      // every other object, remain pinned. Never wholesale rebaseline objects.
      const retained=fresh.metadataRows.filter(([name])=>old.has(name)||!permitted.has(name));
      if(json(retained)!==json(state.metadataRows))throw fail('stale','Foreign repository metadata mutation during blob append.');
      const loose=await readPlain(path.join(state.directory,...object.split('/')),MAX_FILE+65536,signal);
      const raw=Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes]);
      const inflated=inflateSync(loose.bytes,{maxOutputLength:raw.length,info:true});
      if(inflated.engine.bytesWritten!==loose.bytes.length||!inflated.buffer.equals(raw)||!fresh.metadataRows.some(([name,row])=>name===object&&json(row)===json(loose.identity)))throw fail('stale','Stored target blob changed.');
      const metadataRows=fresh.metadataRows,metadataHash=hash(json(metadataRows));
      baseline={...state,metadataRows,metadataHash};
      if(fingerprint(fresh)!==fingerprint(baseline))throw fail('stale','Repository changed during blob append.');
      await lock.writeCandidate(expected);
      let indexPublishStarted=false;
      await lock.publish({assertAuthorized:async()=>{await authorize();if(!indexPublishStarted)await revalidate();},beforePublish:async()=>{await revalidate();},onStart:()=>{indexPublishStarted=true;return start();}});
      const after=await capture(repo,selected,signal,{published:true,operation,partialMM},context);
      const entries=parseGitIndex(expected,{objectFormat:state.objectFormat}).entries;
      const published={...baseline,index:after.index,entries,selected:entries.find(e=>e.path===selected)};
      if(!after.bytes.equals(expected)||fingerprint(after)!==fingerprint(published))throw fail('stale','Post-publication verification failed.');
      await authorize();return {path:selected,head:state.commit,index:{...target}};
    });
    check(signal);return result;
  }catch(error){if(!started)throw error;throw Object.assign(fail('outcome-unknown','Append-only object may remain and Index publication may have occurred; refresh and do not retry blindly.'),{outcomeUnknown:true,appendOnly:true,cause:error});}
}
