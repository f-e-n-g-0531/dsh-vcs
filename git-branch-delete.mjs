// Internal only: caller owns the repository mutation mutex and trusted callbacks.
// No RPC/UI/commit adapter. Hostile concurrent directory replacement is excluded:
// portable Node path/identity checks cannot provide dirfd-relative isolation.
// Packed refs, linked/shared metadata, reftable and alternates fail closed.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {git} from './local-command.mjs';
import {withOperationBudget,currentOperationBudget} from './src/operation-budget.mjs';

const fail=(kind,message,cause)=>Object.assign(new Error(message,{cause}),{code:'vcs/branch-delete-'+kind});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;
const plain=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n;
const decode=b=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
function validRef(ref){
  const name=typeof ref==='string'&&ref.startsWith('refs/heads/')?ref.slice(11):'';
  if(!name||Buffer.from(name,'utf8').toString('utf8')!==name||Buffer.byteLength(name)>1000||
    name==='@'||name.toUpperCase()==='HEAD'||name.startsWith('-')||name.startsWith('refs/')||/[\x00-\x20\x7f~^:?*\[\\<>"|\p{Cc}\p{Cf}]/u.test(name)||name.includes('..')||name.includes('@{')||
    name.split('/').some(p=>!p||Buffer.byteLength(p)>255||p.startsWith('.')||/[. ]$/.test(p)||p.toLowerCase().endsWith('.lock')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
    throw fail('invalid','An exact safe portable refs/heads branch is required.');
}

/** Internal low-level OID CAS only: NO merged/ancestry or user-delete authorization.
 * Caller MUST hold the repository writer mutex and supply trusted callbacks.
 * Deletes exactly one direct loose branch; returns {ref,expectedOid}.
 * No checkout, HEAD/index/worktree/object mutation, force, retry or rollback.
 * Original HEAD raw bytes, direct tip, HEAD/current-branch logs and optional index
 * metadata are pinned. This is NOT full namespace/adapter verification.
 * Packed refs wholesale, shared/linked metadata, unsafe config and locks refused.
 * Own empty external hooks directory and fixed Dsh audit attribution only.
 * All failures after entering synchronous onStart are outcome-unknown, even when
 * the mutation command was not run. Never recreate a target or remove a competitor.
 * After onStart we re-read the raw target to reject an OBSERVED symbolic/OID
 * replacement before Git. This is not atomic raw-type CAS: Git --no-deref with
 * old OID can delete a symbolic ref resolving to that OID (destination untouched).
 * A replacement after that read can therefore evade type observation. The actual
 * atomic boundary is Git's old-OID comparison, not proof of a direct raw ref.
 * Trust synchronous onStart; no hostile directory-swap isolation or ABA guarantee.
 */
export async function deleteLocalBranch(repo,{ref,expectedOid,objectFormat,signal,assertAuthorized,onStart}={}){
  const root=repo?.root;
  validRef(ref);
  const oidPattern=objectFormat==='sha1'?/^[0-9a-f]{40}$/:objectFormat==='sha256'?/^[0-9a-f]{64}$/:null;
  if(repo?.type!=='git'||typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root||
    !oidPattern||typeof expectedOid!=='string'||!oidPattern.test(expectedOid)||/^0+$/.test(expectedOid)||
    typeof assertAuthorized!=='function'||typeof onStart!=='function')throw fail('invalid','Canonical embedded Git root, a full commit OID and callbacks required.');
  let started=false,hooks,owned,headText,headRef,headOid,indexVersion,headLog,branchLog;
  const directory=path.join(root,'.git'),identities=new Map();
  const check=()=>{signal?.throwIfAborted();currentOperationBudget()?.throwIfExpired();};
  const authorize=async()=>{check();await assertAuthorized();check();};
  async function dir(p){
    check();const s=await fs.lstat(p,{bigint:true});
    if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(p)!==p||(identities.has(p)&&!same(identities.get(p),s)))throw fail('unsafe','Noncanonical or replaced directory.');
    identities.set(p,s);return s;
  }
  async function read(p,max=4096){
    check();const before=await fs.lstat(p,{bigint:true});
    if(!plain(before)||before.size>BigInt(max))throw fail('unsafe','Expected bounded single-link metadata.');
    const h=await fs.open(p,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    try{
      const opened=await h.stat({bigint:true});
      if(!plain(opened)||!same(before,opened))throw fail('unsafe','Metadata replaced.');
      const b=Buffer.alloc(max+1);let n=0;
      while(n<b.length){check();const r=await h.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;}
      const after=await h.stat({bigint:true}),now=await fs.lstat(p,{bigint:true});
      if(n>max||!plain(now)||!same(opened,now)||opened.size!==after.size||opened.mtimeNs!==after.mtimeNs||opened.ctimeNs!==after.ctimeNs||after.size!==now.size||after.mtimeNs!==now.mtimeNs||after.ctimeNs!==now.ctimeNs||BigInt(n)!==after.size)throw fail('unsafe','Metadata changed.');
      return decode(b.subarray(0,n));
    }finally{await h.close();}
  }
  async function metadata(){
    await dir(root);let count=0;
    const forbidden=new Set(['commondir','gitdir','worktrees','reftable','packed-refs','shallow','config.worktree','objects/info/alternates','objects/info/http-alternates','MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','sequencer'].map(s=>s.toLowerCase()));
    async function visit(p,rel){
      check();if(++count>20000)throw fail('unsupported','Metadata node bound exceeded.');
      const lower=rel.toLowerCase();
      if(forbidden.has(lower)||lower.endsWith('.lock')||lower.endsWith('.promisor')||lower.startsWith('sharedindex.'))throw fail('unsupported','Unsupported metadata or lock: '+rel);
      const s=await fs.lstat(p,{bigint:true});
      if(s.isSymbolicLink()||await fs.realpath(p)!==p)throw fail('unsafe','Linked metadata.');
      if(s.isDirectory()){await dir(p);for(const name of await fs.readdir(p))await visit(path.join(p,name),rel?rel+'/'+name:name);}
      else if(!plain(s))throw fail('unsafe','Shared or special metadata.');
    }
    await visit(directory,'');
  }
  const run=(args,max=16384)=>{check();return git(root,['-c','core.hooksPath='+hooks,'-c','user.name=Dsh','-c','user.email=dsh@localhost','-c','committer.name=Dsh','-c','committer.email=dsh@localhost','--git-dir='+directory,'--work-tree='+root,...args],max,{signal});};
  async function config(){
    // FIRST Git call: never expand include/includeIf (including global/system).
    const rows=decode(await run(['config','--no-includes','--null','--list'],128*1024)).split('\0').filter(Boolean);
    for(const row of rows){const i=row.indexOf('\n'),key=(i<0?row:row.slice(0,i)).toLowerCase(),value=i<0?'':row.slice(i+1).toLowerCase();
      if(key.startsWith('include')||key.startsWith('extensions.')&&key!=='extensions.objectformat'||key==='core.worktree'||key==='core.repositoryformatversion'&&!['0','1'].includes(value)||key==='core.bare'&&value!=='false'||key==='core.sharedrepository'&&!['false','0'].includes(value)||/^remote\..*\.(promisor|partialclonefilter)$/.test(key))throw fail('unsupported','Unsupported configuration: '+key);
    }
  }
  async function indexStat(){
    check();try{
      const s=await fs.lstat(path.join(directory,'index'),{bigint:true});
      if(!plain(s))throw fail('unsafe','Index must be single-link regular metadata.');
      return s;
    }catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  function sameVersion(a,b){return a===null?b===null:b!==null&&same(a,b)&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;}
  async function exactPath(parts){
    let parent=directory;
    for(let i=0;i<parts.length;i++){
      const matches=(await fs.readdir(parent)).filter(n=>n.toLowerCase()===parts[i].toLowerCase());
      if(matches.length!==1||matches[0]!==parts[i])throw fail('stale','Missing target or portable namespace alias.');
      parent=path.join(parent,parts[i]);if(i<parts.length-1)await dir(parent);
    }
    return parent;
  }
  async function directTarget(){
    const file=await exactPath(ref.split('/'));
    if(await read(file,65)!==expectedOid+'\n')throw fail('stale','Target must remain the exact expected direct OID.');
  }
  async function optionalLog(parts){
    try{return await read(path.join(directory,'logs',...parts),2*1024*1024);}
    catch(error){if(error.code==='ENOENT')return null;throw error;}
  }
  async function absentTarget(){
    for(const file of [path.join(directory,...ref.split('/')),path.join(directory,'logs',...ref.split('/'))]){
      try{await fs.lstat(file);throw fail('stale','Deleted target or target reflog still exists.');}
      catch(error){if(error.code!=='ENOENT')throw error;}
    }
  }
  async function state(deleted=false){
    await metadata();await config();
    const current=await read(path.join(directory,'HEAD'));
    if(headText===undefined){
      if(!current.startsWith('ref: ')||!current.endsWith('\n'))throw fail('stale','Existing born symbolic HEAD required.');
      headRef=current.slice(5,-1);validRef(headRef);headText=current;
      if(headRef.toLowerCase()===ref.toLowerCase())throw fail('invalid','Cannot delete current branch or case-insensitive alias.');
      await exactPath(headRef.split('/'));
      headLog=await optionalLog(['HEAD']);branchLog=await optionalLog(headRef.split('/'));
      headOid=(await read(path.join(directory,...headRef.split('/')))).replace(/\n$/,'');
      if(!oidPattern.test(headOid)||/^0+$/.test(headOid))throw fail('stale','HEAD must name a born direct commit.');
    }
    if(current!==headText||await read(path.join(directory,...headRef.split('/')))!==headOid+'\n')throw fail('stale','Original HEAD changed.');
    await exactPath(headRef.split('/'));
    if(await optionalLog(['HEAD'])!==headLog||await optionalLog(headRef.split('/'))!==branchLog)throw fail('stale','Original HEAD or current branch reflog changed.');
    if(deleted)await absentTarget();else await directTarget();
    const facts=decode(await run(['rev-parse','--absolute-git-dir','--git-common-dir','--show-toplevel','--is-bare-repository','--show-object-format','--verify','HEAD'])).trimEnd().split('\n');
    if(facts.length!==6||path.resolve(root,facts[0])!==directory||path.resolve(root,facts[1])!==directory||path.resolve(facts[2])!==root||facts[3]!=='false'||facts[4]!==objectFormat||facts[5]!==headOid)throw fail('stale','Git repository facts changed.');
    const now=await indexStat();
    if(indexVersion===undefined)indexVersion=now;
    else if(!sameVersion(indexVersion,now))throw fail('stale','Index metadata version changed.');
  }
  async function verifyHooks(){
    const s=await fs.lstat(hooks,{bigint:true});
    if(!s.isDirectory()||s.isSymbolicLink()||!same(owned,s)||await fs.realpath(hooks)!==hooks||(await fs.readdir(hooks)).length)throw fail('unsafe','Owned hooks directory changed or is not empty.');
  }
  try{
    return await withOperationBudget({signal},async()=>{
      await authorize();await metadata();
      const temp=await fs.realpath(os.tmpdir());
      if(temp===root||temp.startsWith(root+path.sep))throw fail('unsafe','Hooks directory must be outside repository.');
      hooks=await fs.mkdtemp(path.join(temp,'dsh-branch-delete-hooks-'+process.pid+'-'));owned=await fs.lstat(hooks,{bigint:true});await verifyHooks();
      await state();
      if(decode(await run(['cat-file','-t',expectedOid],1024))!=='commit\n')throw fail('invalid','expectedOid must name a real existing commit object.');
      if(decode(await run(['cat-file','-t',headOid],1024))!=='commit\n')throw fail('invalid','Expected born branch must name a commit.');
      await authorize();await state();await verifyHooks();check();
      started=true;const result=onStart();
      if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw fail('invalid','onStart must be synchronous.');}
      // Observation only: a later symbolic replacement is not atomically excluded.
      await directTarget();check();
      await run(['update-ref','--no-deref','-d',ref,expectedOid],4096);
      await authorize();await state(true);await authorize();check();
      return {ref,expectedOid};
    });
  }catch(error){
    if(started)throw Object.assign(fail('outcome-unknown','Branch update outcome is unknown; inspect before any further action.',error),{outcomeUnknown:true});
    throw error;
  }finally{
    // Never recursively remove, unlink foreign entries, or delete a replaced path.
    if(hooks&&owned)try{const s=await fs.lstat(hooks,{bigint:true});if(s.isDirectory()&&!s.isSymbolicLink()&&same(owned,s)&&await fs.realpath(hooks)===hooks&&(await fs.readdir(hooks)).length===0)await fs.rmdir(hooks);}catch{}
  }
}
