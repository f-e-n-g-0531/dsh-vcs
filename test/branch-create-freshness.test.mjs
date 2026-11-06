import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {git} from '../local-command.mjs';
import {prepareBranchCreate,applyBranchCreate} from '../branch-create-preview.mjs';
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
 const outer=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-branch-fresh-')));
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
 return {repo,file,head,ref,global,system,preview:()=>prepareBranchCreate(repo,{name:'nested/new'})};
}
const unknown=e=>e.code==='vcs/branch-create-outcome-unknown'&&e.outcomeUnknown===true;
for(const format of ['sha1','sha256'])test(format+' one apply full authentication and bounded deterministic Git startups',async t=>{
 const f=await fixture(t,format),snapshot=await f.preview(),commands=[];let auth=0,starts=0;
 observe=args=>commands.push(command(args));
 await applyBranchCreate(f.repo,{snapshot,assertAuthorized:()=>{auth++;},onStart:()=>{starts++;}});
 assert.equal(auth,5);assert.equal(starts,1);
 assert.equal(commands.filter(a=>a[0]==='cat-file'&&a[1]==='commit').length,1);
 assert.equal(commands.filter(a=>a[0]==='rev-parse').length,5); // full reader 2 + primitive 3
 assert.equal(commands.filter(a=>a[0]==='update-ref').length,1);
 assert.ok(commands.length<35,JSON.stringify(commands));
 t.diagnostic('apply Git startups: '+commands.length+'; '+JSON.stringify(Object.fromEntries([...new Set(commands.map(a=>a[0]))].map(c=>[c,commands.filter(a=>a[0]===c).length]))));
 assert.equal(await fs.readFile(f.file('.git','refs','heads','nested','new'),'utf8'),f.head+'\n');
});
for(const scope of ['global','system'])for(const timing of ['before apply','first authorization','final authorization'])test(scope+' alias change '+timing+' rejects, never rebaselines',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let auth=0,starts=0;
 const mutate=()=>fs.writeFile(f[scope],'[alias]\n unsafe = !echo must-not-run\n');
 if(timing==='before apply')await mutate();
 await assert.rejects(applyBranchCreate(f.repo,{snapshot,assertAuthorized:async()=>{
  if(++auth===(timing==='first authorization'?1:timing==='final authorization'?5:-1))await mutate();
 },onStart:()=>{starts++;}}),timing==='final authorization'?unknown:e=>!e.outcomeUnknown);
 assert.equal(starts,timing==='final authorization'?1:0);
 await assert.rejects(applyBranchCreate(f.repo,{snapshot,assertAuthorized:()=>{},onStart:()=>{}}),/consumed/);
 if(starts)assert.equal(await fs.readFile(f.file('.git','refs','heads','nested','new'),'utf8'),f.head+'\n');
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
 await assert.rejects(applyBranchCreate(f.repo,{snapshot,assertAuthorized:async()=>{if(++auth===5&&timing==='final authorization')await mutate();},onStart:()=>{starts++;}}),timing==='final authorization'?unknown:e=>!e.outcomeUnknown);
 assert.equal(mutated,true);assert.equal(starts,timing==='final authorization'?1:0);
 if(starts)assert.equal(await fs.readFile(f.file('.git','refs','heads','nested','new'),'utf8'),f.head+'\n');
});
test('source guard: one apply full reader, strict original metadata and bounded no-includes config',async()=>{
 const source=await fs.readFile(new URL('../branch-create-preview.mjs',import.meta.url),'utf8');
 const apply=source.slice(source.indexOf('export async function applyBranchCreate'));
 assert.equal((apply.match(/await readLatestCommit\(/g)||[]).length,1);
 assert.match(source,/await visit\(git,''\)/);assert.match(source,/nodes>20000/);
 assert.match(source,/'config','--no-includes','--null','--list'/);
 assert.match(source,/configBaseline=await effectiveConfig\(r.root\)/);
 assert.doesNotMatch(apply,/bound\.before\s*=/);
});
