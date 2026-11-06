import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import syncfs from 'node:fs';
import {withOperationBudget} from '../src/operation-budget.mjs';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {git} from '../local-command.mjs';
import {prepareBranchDelete,applyBranchDelete} from '../branch-delete-preview.mjs';
const spawn=cp.spawn;let environment,observe;
cp.spawn=(command,args,options)=>{
 if(command==='git')observe?.(args);
 return spawn(command,args,{...options,env:{...options?.env,...environment}});
};syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
test.afterEach(()=>{observe=undefined;environment=undefined;});
// Strip safeGit's -c prefix (and the primitive's attribution -c pairs), rather
// than assuming argv[0] is a command or counting command-like config values.
function command(args){
 for(let i=0;i<args.length;i++){
  if(args[i]==='-c'){i++;continue;}
  if(!args[i].startsWith('-'))return args.slice(i);
 }return [];
}
async function fixture(t,format='sha1'){
 const outer=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-delete-fresh-')));
 t.after(()=>fs.rm(outer,{recursive:true,force:true,maxRetries:5}));
 const root=path.join(outer,'repo');await fs.mkdir(root);
 const global=path.join(outer,'global'),system=path.join(outer,'system');
 await fs.writeFile(global,'');await fs.writeFile(system,'');
 environment={GIT_CONFIG_GLOBAL:global,GIT_CONFIG_SYSTEM:system,GIT_CONFIG_NOSYSTEM:'0'};
 const file=(...p)=>path.join(root,...p),run=(...a)=>git(root,a),repo={type:'git',root};
 await run('init','--object-format='+format);await run('config','core.autocrlf','false');
 const tree=(await run('mktree')).toString().trim(),ref=(await fs.readFile(file('.git','HEAD'),'utf8')).trim().slice(5);
 const body=path.join(outer,'commit');await fs.writeFile(body,'tree '+tree+'\nauthor A <a@invalid> 1700000000 +0000\ncommitter C <c@invalid> 1700000000 +0000\n\nfresh\n');
 const head=(await run('hash-object','-t','commit','-w','--',body)).toString().trim();
 await fs.writeFile(file('.git',...ref.split('/')),head+'\n');
 await fs.mkdir(file('.git','refs','heads','nested'),{recursive:true});await fs.writeFile(file('.git','refs','heads','nested','target'),head+'\n');
 await fs.mkdir(file('.git','logs','refs','heads','nested'),{recursive:true});await fs.writeFile(file('.git','logs','refs','heads','nested','target'),'target log\n');
 return {repo,file,head,ref,global,system,preview:()=>prepareBranchDelete(repo,{name:'nested/target'})};
}
async function targetState(f,deleted){
 for(const parts of [['refs','heads','nested','target'],['logs','refs','heads','nested','target']]){
  const file=f.file('.git',...parts);
  if(deleted)await assert.rejects(fs.lstat(file),{code:'ENOENT'});
  else assert.equal(await fs.readFile(file,'utf8'),parts[0]==='refs'?f.head+'\n':'target log\n');
 }
}
const unknown=e=>e.code==='vcs/branch-delete-outcome-unknown'&&e.outcomeUnknown===true;
for(const format of ['sha1','sha256'])test(format+' one apply full authentication and bounded deterministic Git startups',async t=>{
 const f=await fixture(t,format),snapshot=await f.preview(),commands=[];let auth=0,starts=0;
 observe=args=>commands.push(command(args));
 await applyBranchDelete(f.repo,{snapshot,assertAuthorized:()=>{auth++;},onStart:()=>{starts++;}});
 assert.equal(auth,5);assert.equal(starts,1);
 assert.equal(commands.filter(a=>a[0]==='cat-file'&&a[1]==='commit').length,1);
 assert.equal(commands.filter(a=>a[0]==='rev-parse').length,5); // full reader 2 + primitive 3
 assert.equal(commands.filter(a=>a[0]==='update-ref').length,1);
 assert.equal(commands.length,30,JSON.stringify(commands));assert.ok(commands.length<=30);
 assert.equal(commands.filter(a=>a[0]==='config').length,19);
 assert.equal(commands.filter(a=>a[0]==='check-ref-format').length,2);
 assert.equal(commands.filter(a=>a[0]==='cat-file'&&a[1]==='-t').length,2);
 t.diagnostic('apply Git startups: '+commands.length+'; '+JSON.stringify(Object.fromEntries([...new Set(commands.map(a=>a[0]))].map(c=>[c,commands.filter(a=>a[0]===c).length]))));
 await assert.rejects(fs.lstat(f.file('.git','refs','heads','nested','target')),{code:'ENOENT'});
 await assert.rejects(fs.lstat(f.file('.git','logs','refs','heads','nested','target')),{code:'ENOENT'});
});
for(const scope of ['global','system'])for(const timing of ['before apply','first authorization','final authorization'])test(scope+' alias change '+timing+' rejects, never rebaselines',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let auth=0,starts=0;
 const mutate=()=>fs.writeFile(f[scope],'[alias]\n unsafe = !echo must-not-run\n');
 if(timing==='before apply')await mutate();
 await assert.rejects(applyBranchDelete(f.repo,{snapshot,assertAuthorized:async()=>{
  if(++auth===(timing==='first authorization'?1:timing==='final authorization'?5:-1))await mutate();
 },onStart:()=>{starts++;}}),timing==='final authorization'?unknown:e=>!e.outcomeUnknown);
 assert.equal(starts,timing==='final authorization'?1:0);
 await assert.rejects(applyBranchDelete(f.repo,{snapshot,assertAuthorized:()=>{},onStart:()=>{}}),/Exact unused/);
 await targetState(f,starts);
});
for(const scope of ['global','system'])test(scope+' unsupported baseline refused by strict prepare policy',async t=>{
 const f=await fixture(t);await fs.writeFile(f[scope],'[alias]\n unsafe = !echo must-not-run\n');
 await assert.rejects(f.preview(),/Unsupported repository configuration/);
});
for(const kind of ['object','index','hook','lock'])for(const timing of ['before apply','final authorization'])test(kind+' original metadata mutation '+timing+' rejects',async t=>{
 const f=await fixture(t);await fs.writeFile(f.file('.git','index'),'opaque original index');
 const snapshot=await f.preview();let auth=0,starts=0,mutated=false;
 const mutate=async()=>{
  if(kind==='object'){const object=f.file('.git','objects',f.head.slice(0,2),f.head.slice(2));await fs.chmod(object,0o600);await fs.appendFile(object,Buffer.from([0]));}
  if(kind==='index')await fs.appendFile(f.file('.git','index'),'changed');
  if(kind==='hook')await fs.writeFile(f.file('.git','hooks','post-update'),'active hook');
  if(kind==='lock')await fs.writeFile(f.file('.git','objects','inventory.lock'),'lock');
  mutated=true;
 };
 if(timing==='before apply')await mutate();
 await assert.rejects(applyBranchDelete(f.repo,{snapshot,assertAuthorized:async()=>{if(++auth===5&&timing==='final authorization')await mutate();},onStart:()=>{starts++;}}),timing==='final authorization'?unknown:e=>!e.outcomeUnknown);
 assert.equal(mutated,true);assert.equal(starts,timing==='final authorization'?1:0);
 await targetState(f,starts);
});
for(const timing of ['first','final'])test(timing+' authorization raw current ref change rejects without resolving it',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let auth=0,starts=0;
 const symbolic='ref: refs/heads/nested/target\n';
 await assert.rejects(applyBranchDelete(f.repo,{snapshot,onStart(){starts++;},assertAuthorized:async()=>{
  if(++auth===(timing==='first'?1:5))await fs.writeFile(f.file('.git',...f.ref.split('/')),symbolic);
 }}),timing==='final'?unknown:e=>!e.outcomeUnknown);
 assert.equal(starts,timing==='first'?0:1);assert.equal(await fs.readFile(f.file('.git',...f.ref.split('/')),'utf8'),symbolic);await targetState(f,starts===1);
});
for(const scope of ['global','system'])test(scope+' closing prepare config change rejects',async t=>{
 const f=await fixture(t);let configs=0;
 observe=args=>{if(command(args)[0]==='config'&&++configs===6)syncfs.writeFileSync(f[scope],'[user]\n name = closing-change\n');};
 await assert.rejects(f.preview(),/Stale current facts/);assert.equal(configs,6);await targetState(f,false);
});
for(const timing of ['first','final'])for(const reason of ['cancel','deadline'])test(timing+' pending authorization bounded by '+reason+' without continuing',async t=>{
 const f=await fixture(t),snapshot=await f.preview(),controller=new AbortController();let auth=0,starts=0,rejectLate;
 const denied=Object.assign(new Error('cancel pending'),{code:'ABORT_ERR'});
 const work=()=>applyBranchDelete(f.repo,{snapshot,signal:controller.signal,onStart(){starts++;},assertAuthorized(){
  if(++auth!==(timing==='first'?1:5))return;
  if(reason==='cancel')setImmediate(()=>controller.abort(denied));
  return new Promise((_,reject)=>{rejectLate=reject;});
 }});
 const pending=reason==='deadline'?withOperationBudget({timeoutMs:12000},work):work();
 await assert.rejects(pending,timing==='final'?unknown:e=>e.code===(reason==='deadline'?'TIMEOUT':'ABORT_ERR')&&!e.outcomeUnknown);
 assert.equal(starts,timing==='final'?1:0);assert.equal(auth,timing==='first'?1:5);
 rejectLate(Error('late authorization rejection is observed'));await new Promise(resolve=>setImmediate(resolve));
 await targetState(f,starts===1);await assert.rejects(work(),/Exact unused/);
});
test('source guard: one apply full reader, strict original metadata and bounded no-includes config',async()=>{
 const source=await fs.readFile(new URL('../branch-delete-preview.mjs',import.meta.url),'utf8');
 const apply=source.slice(source.indexOf('export async function applyBranchDelete'));
 assert.equal((apply.match(/await readLatestCommit\(/g)||[]).length,1);
 assert.match(source,/await visit\(directory,''\)/);assert.match(source,/nodes>20000/);
 assert.match(source,/'config','--no-includes','--null','--list'/);
 assert.match(source,/configBaseline=await effectiveConfig\(r.root\)/);
 assert.doesNotMatch(apply,/authority\.before\s*=/);
});
