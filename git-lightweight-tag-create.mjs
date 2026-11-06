// Internal only: caller owns the repository mutation mutex and trusted callbacks.
// No RPC/UI/commit adapter. Hostile concurrent directory replacement is excluded:
// portable Node path/identity checks cannot provide dirfd-relative isolation.
// Packed refs, linked/shared metadata, reftable and alternates fail closed.
// No external global guarantee or hostile directory-swap/ABA isolation is claimed.
// On supported Git, zero-old --no-deref rejects even dangling symbolic targets;
// the focused real-Git characterization test guards that version-dependent fact.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {parseVerifiedCommit} from './src/verified-commit.mjs';
import {git} from './local-command.mjs';
import {withOperationBudget,currentOperationBudget} from './src/operation-budget.mjs';

const fail=(kind,message,cause)=>Object.assign(new Error(message,{cause}),{code:'vcs/lightweight-tag-create-'+kind});
const same=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs;
const plain=s=>s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n;
const decode=b=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(b);
function validRef(ref,prefix='refs/tags/'){
  const name=typeof ref==='string'&&ref.startsWith(prefix)?ref.slice(prefix.length):'';
  if(!name||Buffer.from(name,'utf8').toString('utf8')!==name||Buffer.byteLength(name)>1000||
    name==='@'||name.toUpperCase()==='HEAD'||name.startsWith('-')||name.startsWith('refs/')||
    /[\x00-\x20\x7f~^:?*\[\\<>"|\p{Cc}\p{Cf}]/u.test(name)||name.includes('..')||name.includes('@{')||
    name.split('/').some(p=>!p||Buffer.byteLength(p)>255||p.startsWith('.')||/[. ]$/.test(p)||p.toLowerCase().endsWith('.lock')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
    throw fail('invalid','An exact safe portable '+prefix+' name is required.');
}

/** Create one absent local tag via Git update-ref --no-deref full-width zero-old CAS.
 * Internal only: the caller MUST hold the repository writer mutex throughout.
 * Existing born symbolic HEAD is pinned as a current fact, never a caller token.
 * Returns {ref,commit}; fixed Dsh audit attribution, not user authorship.
 * Packed refs (even unrelated), linked/shared metadata and locks fail closed.
 * Index bodies are not read: optional index metadata versions are pinned only.
 * No checkout, HEAD/index/worktree/object mutation, signing, network or retry.
 * All failures after synchronous onStart are outcome-unknown. Never roll back,
 * remove a competing ref or Git lock, or retry on the caller's behalf.
 * Trusted callbacks must not mutate filesystem state; onStart must be synchronous.
 * Portable path checks do not isolate hostile concurrent directory replacement.
 */
export async function createLightweightTag(repo,{ref,expectedCommitOid,objectFormat,signal,assertAuthorized,onStart}={}){
  const root=repo?.root;
  validRef(ref);
  const oidPattern=objectFormat==='sha1'?/^[0-9a-f]{40}$/:objectFormat==='sha256'?/^[0-9a-f]{64}$/:null;
  if(repo?.type!=='git'||typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root||
    !oidPattern||typeof expectedCommitOid!=='string'||!oidPattern.test(expectedCommitOid)||/^0+$/.test(expectedCommitOid)||
    typeof assertAuthorized!=='function'||typeof onStart!=='function')throw fail('invalid','Canonical embedded Git root, a full commit OID and callbacks required.');
  let started=false,hooks,owned,headText,headRef,headOid,indexVersion,commitBody,headLogs;
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
  async function absentTarget(){
    // Reject exact, prefix and portable case-fold collisions in both namespaces.
    for(const parts of [ref.split('/'),['logs',...ref.split('/')]]){
      let p=directory;
      for(let i=0;i<parts.length;i++){
        let names;try{names=await fs.readdir(p);}catch(e){if(e.code==='ENOENT')break;throw e;}
        const name=parts[i],matches=names.filter(n=>n.toLowerCase()===name.toLowerCase());
        if(matches.some(n=>n!==name))throw fail('exists','Case-colliding tag namespace.');
        if(!matches.length)break;
        p=path.join(p,name);
        if(i===parts.length-1||(await fs.lstat(p)).isDirectory()===false)throw fail('exists','Target tag, reflog or namespace exists.');
        await dir(p);
      }
    }
  }
  async function optionalRead(p,max=2*1024*1024){
    try{return await read(p,max);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  }
  async function verifyObjects(){
    const target=await run(['cat-file','commit',expectedCommitOid],2*1024*1024);
    parseVerifiedCommit(target,{oid:expectedCommitOid,objectFormat,signal});
    if(commitBody!==undefined&&!commitBody.equals(target))throw fail('stale','Original commit content changed.');
    commitBody=target;
  }
  async function state(created=false){
    await metadata();await config();
    const current=await read(path.join(directory,'HEAD'));
    if(headText===undefined){
      if(!current.startsWith('ref: ')||!current.endsWith('\n'))throw fail('stale','Existing born symbolic HEAD required.');
      headRef=current.slice(5,-1);validRef(headRef,'refs/heads/');headText=current;
      headOid=(await read(path.join(directory,...headRef.split('/')))).replace(/\n$/,'');
      if(!oidPattern.test(headOid)||/^0+$/.test(headOid))throw fail('stale','HEAD must name a born direct commit.');
    }
    if(current!==headText||await read(path.join(directory,...headRef.split('/')))!==headOid+'\n')throw fail('stale','Original HEAD changed.');
    const logs=await Promise.all(['logs/HEAD','logs/'+headRef].map(p=>optionalRead(path.join(directory,...p.split('/')))));
    if(headLogs===undefined)headLogs=logs;
    else if(logs.some((v,i)=>v!==headLogs[i]))throw fail('stale','Original HEAD reflogs changed.');
    if(created){
      if(await read(path.join(directory,...ref.split('/')))!==expectedCommitOid+'\n')throw fail('stale','Created tag is no longer the exact direct commit OID.');
      const log=await optionalRead(path.join(directory,'logs',...ref.split('/')));
      if(log!==null){
        const zero='0'.repeat(expectedCommitOid.length);
        const pattern=new RegExp('^'+zero+' '+expectedCommitOid+' Dsh <dsh@localhost> [0-9]+ [+-][0-9]{4}\\tdsh: create lightweight tag\\n$');
        if(!pattern.test(log))throw fail('stale','Unexpected created tag reflog.');
      }
    }else await absentTarget();
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
      hooks=await fs.mkdtemp(path.join(temp,'dsh-lightweight-tag-hooks-'+process.pid+'-'));owned=await fs.lstat(hooks,{bigint:true});await verifyHooks();
      await state();
      await verifyObjects();
      if(decode(await run(['cat-file','-t',headOid],1024))!=='commit\n')throw fail('invalid','Expected born branch must name a commit.');
      await authorize();await state();await verifyHooks();await verifyObjects();check();
      started=true;const result=onStart();
      if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});throw fail('invalid','onStart must be synchronous.');}
      // No asynchronous work between the notification and mutation subprocess.
      await run(['update-ref','--no-deref','-m','dsh: create lightweight tag',ref,expectedCommitOid,'0'.repeat(expectedCommitOid.length)],4096);
      await authorize();await state(true);await authorize();check();
      return {ref,commit:expectedCommitOid};
    });
  }catch(error){
    if(started)throw Object.assign(fail('outcome-unknown','Tag update outcome is unknown; inspect before any further action.',error),{outcomeUnknown:true});
    throw error;
  }finally{
    // Never recursively remove, unlink foreign entries, or delete a replaced path.
    if(hooks&&owned)try{const s=await fs.lstat(hooks,{bigint:true});if(s.isDirectory()&&!s.isSymbolicLink()&&same(owned,s)&&await fs.realpath(hooks)===hooks&&(await fs.readdir(hooks)).length===0)await fs.rmdir(hooks);}catch{}
  }
}