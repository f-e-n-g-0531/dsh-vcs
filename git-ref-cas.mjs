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

const fail=(kind,message,cause)=>Object.assign(new Error(message,{cause}),{code:'vcs/ref-'+kind});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;
const plain=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n;
const decode=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
function validRef(ref){
  if(typeof ref!=='string'||!ref.startsWith('refs/heads/')||Buffer.byteLength(ref)>1024||
    /[\x00- \x7f~^:?*[\\]/.test(ref)||ref.includes('..')||ref.includes('@{')||ref.endsWith('.')||
    ref.split('/').some(p=>!p||p.startsWith('.')||p.toLowerCase().endsWith('.lock')||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
    throw fail('invalid','An exact safe refs/heads branch is required.');
}

/** Atomically update one born current branch via Git old-OID CAS.
 * Returns {ref,oldOid,newOid}. Reflog uses fixed Dsh <dsh@localhost> machine
 * audit identity, not user attribution. All failures after synchronous onStart
 * (including callback errors/CAS rejection) are outcome-unknown: never retry,
 * reset refs, remove objects or remove Git locks. Authorization must throw on
 * revocation; callbacks must be trusted and must not modify filesystem state.
 * Only Git's normal ref/reflog writes occur. No signing/network/maintenance.
 * No crash/directory durability or hostile filesystem isolation guarantee.
 */
export async function compareAndSwapBranch(repo,{ref,expectedOid,newOid,objectFormat,signal,assertAuthorized,onStart}={}){
  const root=repo?.root;
  validRef(ref);
  const oidPattern=objectFormat==='sha1'?/^[0-9a-f]{40}$/:objectFormat==='sha256'?/^[0-9a-f]{64}$/:null;
  if(repo?.type!=='git'||typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root||
    !oidPattern||![expectedOid,newOid].every(x=>typeof x==='string'&&oidPattern.test(x)&&!/^0+$/.test(x))||expectedOid===newOid||
    typeof assertAuthorized!=='function'||typeof onStart!=='function')throw fail('invalid','Canonical embedded Git root, distinct full OIDs and callbacks required.');
  let started=false,hooks,owned;
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
  const run=(args,max=16384)=>{check();return git(root,['-c','core.hooksPath='+hooks,'-c','user.name=Dsh','-c','user.email=dsh@localhost','-c','committer.name=Dsh','-c','committer.email=dsh@localhost',...args],max,{signal});};
  async function config(){
    // FIRST Git call: never expand include/includeIf (including global/system).
    const rows=decode(await run(['config','--no-includes','--null','--list'],128*1024)).split('\0').filter(Boolean);
    for(const row of rows){const i=row.indexOf('\n'),key=(i<0?row:row.slice(0,i)).toLowerCase(),value=i<0?'':row.slice(i+1).toLowerCase();
      if(key.startsWith('include')||key.startsWith('extensions.')&&key!=='extensions.objectformat'||key==='core.worktree'||key==='core.repositoryformatversion'&&!['0','1'].includes(value)||key==='core.bare'&&value!=='false'||key==='core.sharedrepository'&&!['false','0'].includes(value)||/^remote\..*\.(promisor|partialclonefilter)$/.test(key))throw fail('unsupported','Unsupported configuration: '+key);
    }
  }
  async function state(oid){
    await metadata();await config();
    if(await read(path.join(directory,'HEAD'))!=='ref: '+ref+'\n')throw fail('stale','HEAD must target the exact branch.');
    if(await read(path.join(directory,...ref.split('/')))!==oid+'\n')throw fail('stale','Branch no longer has the expected OID.');
    const facts=decode(await run(['rev-parse','--absolute-git-dir','--git-common-dir','--show-toplevel','--is-bare-repository','--show-object-format','--verify','HEAD'])).trimEnd().split('\n');
    if(facts.length!==6||path.resolve(root,facts[0])!==directory||path.resolve(root,facts[1])!==directory||path.resolve(facts[2])!==root||facts[3]!=='false'||facts[4]!==objectFormat||facts[5]!==oid)throw fail('stale','Git repository facts changed.');
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
      hooks=await fs.mkdtemp(path.join(temp,'dsh-ref-hooks-'+process.pid+'-'));owned=await fs.lstat(hooks,{bigint:true});await verifyHooks();
      await state(expectedOid);
      if(decode(await run(['cat-file','-t',newOid],1024))!=='commit\n')throw fail('invalid','newOid must name a real commit object.');
      if(decode(await run(['cat-file','-t',expectedOid],1024))!=='commit\n')throw fail('invalid','Expected born branch must name a commit.');
      await authorize();await state(expectedOid);await verifyHooks();check();
      started=true;const result=onStart();
      if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw fail('invalid','onStart must be synchronous.');}
      // No asynchronous work between the notification and mutation subprocess.
      await run(['update-ref','--no-deref','-m','dsh: branch compare-and-swap',ref,newOid,expectedOid],4096);
      await authorize();await state(newOid);await authorize();check();
      return {ref,oldOid:expectedOid,newOid};
    });
  }catch(error){
    if(started)throw Object.assign(fail('outcome-unknown','Branch update outcome is unknown; inspect before any further action.',error),{outcomeUnknown:true});
    throw error;
  }finally{
    // Never recursively remove, unlink foreign entries, or delete a replaced path.
    if(hooks&&owned)try{const s=await fs.lstat(hooks,{bigint:true});if(s.isDirectory()&&!s.isSymbolicLink()&&same(owned,s)&&await fs.realpath(hooks)===hooks&&(await fs.readdir(hooks)).length===0)await fs.rmdir(hooks);}catch{}
  }
}
