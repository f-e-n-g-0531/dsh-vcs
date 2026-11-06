import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {deleteLocalBranch} from '../git-branch-delete.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';

async function fixture(t,format='sha1'){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ref-test-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}}).trim();
  git('init','-q','--object-format='+format,'-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@localhost');
  await fs.writeFile(path.join(root,'file'),'one\n');git('add','file');git('commit','-qm','old');const old=git('rev-parse','HEAD');
  await fs.writeFile(path.join(root,'file'),'two\n');git('add','file');git('commit','-qm','new');const next=git('rev-parse','HEAD');git('update-ref','refs/heads/main',old,next);
  git('update-ref','refs/heads/topic/nested',next);
  return {root,git,old,next,repo:{type:'git',root},options:{ref:'refs/heads/topic/nested',expectedOid:next,objectFormat:format,assertAuthorized(){},onStart(){}}};
}
async function snapshot(root){
  const out={};async function visit(p,rel){for(const name of await fs.readdir(p)){const r=rel?rel+'/'+name:name,f=path.join(p,name),s=await fs.lstat(f);if(s.isDirectory()){out[r+'/']='directory';await visit(f,r);}else out[r]=(await fs.readFile(f)).toString('hex');}}await visit(root,'');return out;
}

const unknown={code:'vcs/branch-delete-outcome-unknown',outcomeUnknown:true};
for(const turn of [2,3,4])test('authorization cancellation turn '+turn,async t=>{const f=await fixture(t),c=new AbortController();let n=0,start=false;await assert.rejects(deleteLocalBranch(f.repo,{...f.options,signal:c.signal,assertAuthorized(){if(++n===turn)c.abort();},onStart(){start=true;}}),e=>turn===2?!e.outcomeUnknown:e.outcomeUnknown===true);assert.equal(start,turn!==2);assert.equal(sync.existsSync(target(f)),turn===2);});
test('actual Git old-OID CAS retains changed competitor',async t=>{const f=await fixture(t);f.git('update-ref',f.options.ref,f.old,f.next);assert.throws(()=>f.git('update-ref','--no-deref','-d',f.options.ref,f.next));assert.equal(f.git('rev-parse',f.options.ref),f.old);});
test('HEAD BOM cannot be silently decoded away',async t=>{const f=await fixture(t),file=path.join(f.root,'.git','HEAD');await fs.writeFile(file,Buffer.concat([Buffer.from([239,187,191]),await fs.readFile(file)]));let start=false;await assert.rejects(deleteLocalBranch(f.repo,{...f.options,onStart(){start=true;}}));assert.equal(start,false);});

const target=f=>path.join(f.root,'.git',f.options.ref);
for(const format of ['sha1','sha256'])test('real '+format+' delete preserves dirty staged work and all but target ref/log',async t=>{
  const f=await fixture(t,format),marker=path.join(f.root,'HOOK-RAN');
  await fs.writeFile(path.join(f.root,'file'),'staged\n');f.git('add','file');await fs.writeFile(path.join(f.root,'file'),'dirty\n');
  await fs.writeFile(path.join(f.root,'untracked'),'leave me');
  await fs.writeFile(path.join(f.root,'.git','hooks','reference-transaction'),'#!/bin/sh\necho bad > "'+marker.replaceAll('\\','/')+'"\nexit 1\n',{mode:0o755});
  f.git('config','core.hooksPath',path.join(f.root,'.git','hooks'));
  f.git('config','committer.name','Untrusted');f.git('config','committer.email','untrusted@example.invalid');
  const before=await snapshot(f.root);let starts=0;
  assert.deepEqual(await deleteLocalBranch(f.repo,{...f.options,onStart(){starts++;}}),{ref:f.options.ref,expectedOid:f.next});
  assert.equal(starts,1);assert.equal(f.git('rev-parse','HEAD'),f.old);assert.equal(sync.existsSync(marker),false);
  const after=await snapshot(f.root),changed=Object.keys({...before,...after}).filter(k=>!k.endsWith('/')&&before[k]!==after[k]).sort();
  assert.deepEqual(changed,['.git/logs/'+f.options.ref,'.git/'+f.options.ref].sort());
  assert.equal(sync.existsSync(target(f)),false);assert.equal(sync.existsSync(path.join(f.root,'.git','logs',f.options.ref)),false);
});
for(const ref of ['HEAD','refs/tags/x','refs/heads/','refs/heads/@','refs/heads/HEAD','refs/heads/-bad','refs/heads/refs/x','refs/heads/../x','refs/heads/x.lock','refs/heads/x y','refs/heads/x\\y','refs/heads/x[','refs/heads/a@{x','refs/heads/CON','refs/heads/a\ud800','refs/heads/x.','refs/heads/.bad','refs/heads/x\u200b','refs/heads/x\u0080','refs/heads/a<b','refs/heads/a|b','refs/heads/a"b','refs/heads/'+ 'x'.repeat(256),'refs/heads/'+Array(5).fill('x'.repeat(201)).join('/')])test('reject unsafe exact ref '+JSON.stringify(ref),async t=>{
  const f=await fixture(t);await assert.rejects(deleteLocalBranch(f.repo,{...f.options,ref}),{code:'vcs/branch-delete-invalid'});
});
for(const relative of ['packed-refs','commondir','gitdir','worktrees','reftable','refs/heads/main.lock','logs/HEAD.lock','objects/info/alternates','objects/info/http-alternates','sharedindex.bad','shallow','config.worktree'])test('unsupported metadata '+relative,async t=>{
  const f=await fixture(t),p=path.join(f.root,'.git',relative);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,'unsupported');
  const before=await snapshot(f.root);await assert.rejects(deleteLocalBranch(f.repo,f.options),{code:'vcs/branch-delete-unsupported'});assert.deepEqual(await snapshot(f.root),before);
});
for(const [key,value] of [['include.path','missing-config'],['includeIf.gitdir:*.path','missing'],['core.worktree','.'],['core.sharedRepository','group'],['extensions.refStorage','reftable'],['remote.origin.promisor','true']])test('unsafe config '+key,async t=>{
  const f=await fixture(t);f.git('config',key,value);let start=false;await assert.rejects(deleteLocalBranch(f.repo,{...f.options,onStart(){start=true;}}));assert.equal(start,false);assert.equal(sync.existsSync(target(f)),true);
});
for(const ref of ['refs/heads/main','refs/heads/MAIN'])test('current branch and case alias refused '+ref,async t=>{const f=await fixture(t);await assert.rejects(deleteLocalBranch(f.repo,{...f.options,ref,expectedOid:f.old}),{code:'vcs/branch-delete-invalid'});});
test('symbolic target rejected before start',async t=>{const f=await fixture(t);f.git('symbolic-ref',f.options.ref,'refs/heads/main');let start=false;await assert.rejects(deleteLocalBranch(f.repo,{...f.options,onStart(){start=true;}}));assert.equal(start,false);assert.equal(f.git('rev-parse','HEAD'),f.old);});
for(const oid of ['0'.repeat(40),'abcd','A'.repeat(40),'1'.repeat(64),'HEAD'])test('invalid OID '+oid,async t=>{const f=await fixture(t);await assert.rejects(deleteLocalBranch(f.repo,{...f.options,expectedOid:oid}),{code:'vcs/branch-delete-invalid'});});
test('mismatched direct target refused',async t=>{const f=await fixture(t);await assert.rejects(deleteLocalBranch(f.repo,{...f.options,expectedOid:f.old}),{code:'vcs/branch-delete-stale'});});
test('existing tree is not commit',async t=>{const f=await fixture(t),oid=f.git('rev-parse','HEAD^{tree}');await fs.writeFile(target(f),oid+'\n');let start=false;await assert.rejects(deleteLocalBranch(f.repo,{...f.options,expectedOid:oid,onStart(){start=true;}}),{code:'vcs/branch-delete-invalid'});assert.equal(start,false);});
test('missing object refused',async t=>{const f=await fixture(t),oid='1'.repeat(40);await fs.writeFile(target(f),oid+'\n');let start=false;await assert.rejects(deleteLocalBranch(f.repo,{...f.options,expectedOid:oid,onStart(){start=true;}}));assert.equal(start,false);});
for(const mode of ['detached','unborn'])test(mode+' HEAD refused',async t=>{const f=await fixture(t);if(mode==='detached')f.git('checkout','--detach','-q',f.old);else f.git('symbolic-ref','HEAD','refs/heads/unborn');let start=false;await assert.rejects(deleteLocalBranch(f.repo,{...f.options,onStart(){start=true;}}));assert.equal(start,false);});
test('pre-abort definite no mutation',async t=>{const f=await fixture(t),c=new AbortController();c.abort();const before=await snapshot(f.root);await assert.rejects(deleteLocalBranch(f.repo,{...f.options,signal:c.signal}),e=>!e.outcomeUnknown);assert.deepEqual(await snapshot(f.root),before);});
for(const turn of [1,2,3,4])test('authorization revocation turn '+turn,async t=>{const f=await fixture(t);let n=0,start=false;await assert.rejects(deleteLocalBranch(f.repo,{...f.options,assertAuthorized(){if(++n===turn)throw Error('revoked');},onStart(){start=true;}}),e=>turn<3?e.message==='revoked'&&!e.outcomeUnknown:e.outcomeUnknown===true);assert.equal(start,turn>=3);assert.equal(sync.existsSync(target(f)),turn<3);});
for(const kind of ['abort','throw','async','rejecting thenable'])test('poststart '+kind+' unknown without mutation',async t=>{const f=await fixture(t),c=new AbortController();await assert.rejects(deleteLocalBranch(f.repo,{...f.options,signal:c.signal,onStart(){if(kind==='abort')c.abort();if(kind==='throw')throw Error('start');if(kind==='async')return Promise.resolve();if(kind==='rejecting thenable')return {then(resolve,reject){reject(Error('no'));}};}}),unknown);assert.equal(sync.existsSync(target(f)),true);});
test('changed OID callback competitor retained',async t=>{const f=await fixture(t);await assert.rejects(deleteLocalBranch(f.repo,{...f.options,onStart(){f.git('update-ref',f.options.ref,f.old,f.next);}}),unknown);assert.equal(f.git('rev-parse',f.options.ref),f.old);});
test('observed callback symbolic replacement unknown and destination untouched',async t=>{const f=await fixture(t);f.git('update-ref','refs/heads/destination',f.next);const before=await fs.readFile(path.join(f.root,'.git','refs/heads/destination'));await assert.rejects(deleteLocalBranch(f.repo,{...f.options,onStart(){f.git('symbolic-ref',f.options.ref,'refs/heads/destination');}}),unknown);assert.equal(f.git('symbolic-ref',f.options.ref),'refs/heads/destination');assert.deepEqual(await fs.readFile(path.join(f.root,'.git','refs/heads/destination')),before);});
for(const format of ['sha1','sha256'])test('Git '+format+' characterization: no-deref old-OID deletes symbolic name not destination',async t=>{const f=await fixture(t,format);f.git('update-ref','refs/heads/destination',f.next);f.git('symbolic-ref',f.options.ref,'refs/heads/destination');const before=await snapshot(f.root);f.git('update-ref','--no-deref','-d',f.options.ref,f.next);assert.equal(sync.existsSync(target(f)),false);assert.equal(f.git('rev-parse','refs/heads/destination'),f.next);const after=await snapshot(f.root);for(const k of ['.git/refs/heads/destination','.git/logs/refs/heads/destination','.git/HEAD','.git/refs/heads/main','.git/logs/HEAD','.git/logs/refs/heads/main'])assert.equal(after[k],before[k]);});
for(const where of ['HEAD','index','log'])for(const post of [false,true])test(where+' changed '+(post?'post':'pre')+' start',async t=>{const f=await fixture(t);let n=0,started=false;const change=()=>{if(where==='HEAD')f.git('update-ref','refs/heads/main',f.next,f.old);if(where==='index')sync.appendFileSync(path.join(f.root,'.git','index'),'x');if(where==='log')sync.appendFileSync(path.join(f.root,'.git','logs/HEAD'),'changed\n');};await assert.rejects(deleteLocalBranch(f.repo,{...f.options,assertAuthorized(){if(++n===2&&!post)change();},onStart(){started=true;if(post)change();}}),post?unknown:{code:'vcs/branch-delete-stale'});assert.equal(started,post);assert.equal(sync.existsSync(target(f)),!post);});
for(const relative of ['refs/heads/topic/nested','logs/HEAD'])test('single-link metadata '+relative,async t=>{const f=await fixture(t);await fs.link(path.join(f.root,'.git',relative),path.join(f.root,'foreign'));await assert.rejects(deleteLocalBranch(f.repo,f.options),{code:'vcs/branch-delete-unsafe'});});
test('linked metadata directory refused',async t=>{const f=await fixture(t),p=path.join(f.root,'.git','refs'),save=path.join(f.root,'saved');await fs.rename(p,save);await fs.symlink(save,p,process.platform==='win32'?'junction':'dir');await assert.rejects(deleteLocalBranch(f.repo,f.options),{code:'vcs/branch-delete-unsafe'});});
test('actual unrelated packed refs refused wholesale',async t=>{const f=await fixture(t);f.git('pack-refs','--all','--prune');await fs.mkdir(path.dirname(target(f)),{recursive:true});await fs.writeFile(target(f),f.next+'\n');const before=await snapshot(f.root);await assert.rejects(deleteLocalBranch(f.repo,f.options),{code:'vcs/branch-delete-unsupported'});assert.deepEqual(await snapshot(f.root),before);});
test('missing index remains missing',async t=>{const f=await fixture(t);await fs.unlink(path.join(f.root,'.git','index'));await deleteLocalBranch(f.repo,f.options);assert.equal(sync.existsSync(path.join(f.root,'.git','index')),false);});
test('exact Unicode branch supported',async t=>{const f=await fixture(t),ref='refs/heads/功能/🚀';f.git('update-ref',ref,f.next);await deleteLocalBranch(f.repo,{...f.options,ref});assert.equal(sync.existsSync(path.join(f.root,'.git',ref)),false);});
test('shared prestart deadline not reset',async t=>{const f=await fixture(t);await assert.rejects(withOperationBudget({timeoutMs:1},()=>deleteLocalBranch(f.repo,f.options)),{code:'TIMEOUT'});assert.equal(sync.existsSync(target(f)),true);});
test('poststart deadline expires unknown before mutation',async t=>{const f=await fixture(t);await assert.rejects(withOperationBudget({timeoutMs:5000},()=>deleteLocalBranch(f.repo,{...f.options,onStart(){const until=Date.now()+5100;while(Date.now()<until){}}})),unknown);assert.equal(sync.existsSync(target(f)),true);});
test('target recreated post mutation is unknown and retained',async t=>{const f=await fixture(t);let n=0;await assert.rejects(deleteLocalBranch(f.repo,{...f.options,assertAuthorized(){if(++n===3)f.git('update-ref',f.options.ref,f.old);}}),unknown);assert.equal(f.git('rev-parse',f.options.ref),f.old);});
test('owned external hooks directory cleaned',async t=>{const f=await fixture(t),tmp=await fs.realpath(os.tmpdir()),before=new Set(await fs.readdir(tmp));let owned;await deleteLocalBranch(f.repo,{...f.options,onStart(){const names=sync.readdirSync(tmp).filter(n=>n.startsWith('dsh-branch-delete-hooks-'+process.pid+'-')&&!before.has(n));assert.equal(names.length,1);owned=path.join(tmp,names[0]);assert.deepEqual(sync.readdirSync(owned),[]);}});assert.equal(sync.existsSync(owned),false);});
