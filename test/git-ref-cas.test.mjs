import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {compareAndSwapBranch} from '../git-ref-cas.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';

async function fixture(t,format='sha1'){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ref-test-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}}).trim();
  git('init','-q','--object-format='+format,'-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@localhost');
  await fs.writeFile(path.join(root,'file'),'one\n');git('add','file');git('commit','-qm','old');const old=git('rev-parse','HEAD');
  await fs.writeFile(path.join(root,'file'),'two\n');git('add','file');git('commit','-qm','new');const next=git('rev-parse','HEAD');git('update-ref','refs/heads/main',old,next);
  return {root,git,old,next,repo:{type:'git',root},options:{ref:'refs/heads/main',expectedOid:old,newOid:next,objectFormat:format,assertAuthorized(){},onStart(){}}};
}
async function snapshot(root){
  const out={};async function visit(p,rel){for(const name of await fs.readdir(p)){const r=rel?rel+'/'+name:name,f=path.join(p,name),s=await fs.lstat(f);if(s.isDirectory())await visit(f,r);else out[r]=(await fs.readFile(f)).toString('hex');}}await visit(root,'');return out;
}
for(const format of ['sha1','sha256'])test('real '+format+' CAS changes only branch/reflogs and suppresses reference hooks',async t=>{
  const f=await fixture(t,format),marker=path.join(f.root,'HOOK-RAN');
  await fs.writeFile(path.join(f.root,'.git','hooks','reference-transaction'),'#!/bin/sh\necho bad > "'+marker.replaceAll('\\','/')+'"\nexit 1\n',{mode:0o755});
  f.git('config','core.hooksPath',path.join(f.root,'.git','hooks'));
  f.git('config','committer.name','Untrusted');f.git('config','committer.email','untrusted@example.invalid');
  const before=await snapshot(f.root);let starts=0;
  assert.deepEqual(await compareAndSwapBranch(f.repo,{...f.options,onStart(){starts++;}}),{ref:'refs/heads/main',oldOid:f.old,newOid:f.next});
  assert.equal(starts,1);assert.equal(f.git('rev-parse','HEAD'),f.next);assert.equal(sync.existsSync(marker),false);
  const after=await snapshot(f.root),changed=Object.keys({...before,...after}).filter(k=>before[k]!==after[k]).sort();
  assert.deepEqual(changed,['.git/logs/HEAD','.git/logs/refs/heads/main','.git/refs/heads/main']);
  const log=await fs.readFile(path.join(f.root,'.git','logs','refs','heads','main'),'utf8');assert.match(log,/Dsh <dsh@localhost>.*dsh: branch compare-and-swap/);
});
test('stale old OID never forces update or calls onStart',async t=>{const f=await fixture(t);f.git('update-ref','refs/heads/main',f.next,f.old);let started=false;await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,onStart(){started=true;}}),{code:'vcs/ref-stale'});assert.equal(started,false);assert.equal(f.git('rev-parse','HEAD'),f.next);});
for(const bad of ['HEAD','refs/tags/x','refs/heads/../x','refs/heads/x.lock','refs/heads/x y','refs/heads/x\\y','refs/heads/x[','refs/heads/a@{x','refs/heads/CON'])test('reject exact unsafe ref '+bad,async t=>{const f=await fixture(t);await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,ref:bad}),{code:'vcs/ref-invalid'});});
for(const field of ['expectedOid','newOid'])for(const value of ['zero','short','upper','equal'])test('reject '+field+' '+value,async t=>{const f=await fixture(t);const oid=value==='zero'?'0'.repeat(40):value==='short'?f.next.slice(0,12):value==='upper'?f.next.toUpperCase():field==='newOid'?f.old:f.next;await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,[field]:oid}),{code:'vcs/ref-invalid'});});
for(const relative of ['packed-refs','commondir','worktrees','reftable','refs/heads/main.lock','logs/HEAD.lock','objects/info/alternates','sharedindex.bad'])test('reject unsupported metadata '+relative,async t=>{const f=await fixture(t),p=path.join(f.root,'.git',relative);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,'unsupported');await assert.rejects(compareAndSwapBranch(f.repo,f.options),{code:'vcs/ref-unsupported'});assert.equal((await fs.readFile(path.join(f.root,'.git','refs','heads','main'),'utf8')).trim(),f.old);});
test('include config rejected before expanded config is read',async t=>{const f=await fixture(t);f.git('config','include.path',path.join(f.root,'missing-config'));await assert.rejects(compareAndSwapBranch(f.repo,f.options),{code:'vcs/ref-unsupported'});});
test('symbolic target branch rejected',async t=>{const f=await fixture(t);f.git('update-ref','refs/heads/other',f.old);f.git('symbolic-ref','refs/heads/main','refs/heads/other');await assert.rejects(compareAndSwapBranch(f.repo,f.options),{code:'vcs/ref-stale'});});
test('detached HEAD rejected',async t=>{const f=await fixture(t);f.git('checkout','--detach','-q',f.old);await assert.rejects(compareAndSwapBranch(f.repo,f.options),{code:'vcs/ref-stale'});});
test('new object must really be a commit',async t=>{const f=await fixture(t),tree=f.git('rev-parse','HEAD^{tree}');await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,newOid:tree}),{code:'vcs/ref-invalid'});});
test('missing new object fails before start',async t=>{const f=await fixture(t);let started=false;await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,newOid:'1'.repeat(40),onStart(){started=true;}}));assert.equal(started,false);});
test('pre-abort never starts',async t=>{const f=await fixture(t),c=new AbortController();c.abort();let started=false;await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,signal:c.signal,onStart(){started=true;}}));assert.equal(started,false);});
test('pre-start authorization revocation stays definite',async t=>{const f=await fixture(t);let n=0;await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,assertAuthorized(){if(++n===2)throw Error('revoked');}}),/revoked/);assert.equal(f.git('rev-parse','HEAD'),f.old);});
test('post-start abort is conservative outcome unknown',async t=>{const f=await fixture(t),c=new AbortController();await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,signal:c.signal,onStart(){c.abort();}}),e=>e.code==='vcs/ref-outcome-unknown'&&e.outcomeUnknown===true);assert.equal(f.git('rev-parse','HEAD'),f.old);});
test('onStart throw is outcome unknown',async t=>{const f=await fixture(t);await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,onStart(){throw Error('start failure');}}),{code:'vcs/ref-outcome-unknown',outcomeUnknown:true});});
test('post-write auth revocation does not roll back ref',async t=>{const f=await fixture(t);let n=0;await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,assertAuthorized(){if(++n===3)throw Error('revoked');}}),{code:'vcs/ref-outcome-unknown',outcomeUnknown:true});assert.equal(f.git('rev-parse','HEAD'),f.next);});
test('external competing update at start is not overwritten; CAS rejection unknown',async t=>{const f=await fixture(t);const other=f.git('commit-tree',f.git('rev-parse','HEAD^{tree}'),'-p',f.old,'-m','external');await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,onStart(){f.git('update-ref','refs/heads/main',other,f.old);}}),{code:'vcs/ref-outcome-unknown',outcomeUnknown:true});assert.equal(f.git('rev-parse','HEAD'),other);});
test('shared outer deadline is not reset',async t=>{const f=await fixture(t);await assert.rejects(withOperationBudget({timeoutMs:1},()=>compareAndSwapBranch(f.repo,f.options)),{code:'TIMEOUT'});assert.equal(f.git('rev-parse','HEAD'),f.old);});
test('async onStart rejected as unknown without mutation',async t=>{const f=await fixture(t);await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,async onStart(){}}),{code:'vcs/ref-outcome-unknown',outcomeUnknown:true});assert.equal(f.git('rev-parse','HEAD'),f.old);});
for(const relative of ['refs/heads/main','logs/HEAD'])test('hardlinked metadata rejected '+relative,async t=>{const f=await fixture(t);await fs.link(path.join(f.root,'.git',relative),path.join(f.root,'foreign-link'));await assert.rejects(compareAndSwapBranch(f.repo,f.options),{code:'vcs/ref-unsafe'});});
test('linked refs directory rejected',async t=>{const f=await fixture(t),refs=path.join(f.root,'.git','refs'),saved=path.join(f.root,'saved-refs');await fs.rename(refs,saved);await fs.symlink(saved,refs,process.platform==='win32'?'junction':'dir');await assert.rejects(compareAndSwapBranch(f.repo,f.options),{code:'vcs/ref-unsafe'});});
test('owned hooks directory cleaned after success',async t=>{const f=await fixture(t),temp=await fs.realpath(os.tmpdir()),before=new Set(await fs.readdir(temp));let owned;await compareAndSwapBranch(f.repo,{...f.options,onStart(){owned=sync.readdirSync(temp).filter(n=>n.startsWith('dsh-ref-hooks-'+process.pid+'-')&&!before.has(n));assert.equal(owned.length,1);}});assert.equal(sync.existsSync(path.join(temp,owned[0])),false);});
test('foreign hook entries retained on aborted cleanup',async t=>{const f=await fixture(t),c=new AbortController(),temp=await fs.realpath(os.tmpdir()),before=new Set(await fs.readdir(temp));let owned;await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,signal:c.signal,onStart(){const names=sync.readdirSync(temp).filter(n=>n.startsWith('dsh-ref-hooks-'+process.pid+'-')&&!before.has(n));assert.equal(names.length,1);owned=path.join(temp,names[0]);sync.writeFileSync(path.join(owned,'foreign'),'retain');c.abort();}}),{code:'vcs/ref-outcome-unknown',outcomeUnknown:true});t.after(()=>fs.rm(owned,{recursive:true,force:true}));assert.equal(await fs.readFile(path.join(owned,'foreign'),'utf8'),'retain');});
test('config worktree redirect rejected',async t=>{const f=await fixture(t);f.git('config','core.worktree',f.root);await assert.rejects(compareAndSwapBranch(f.repo,f.options),{code:'vcs/ref-unsupported'});});
test('supplied format must match actual repository',async t=>{const f=await fixture(t);await assert.rejects(compareAndSwapBranch(f.repo,{...f.options,objectFormat:'sha256',expectedOid:'a'.repeat(64),newOid:'b'.repeat(64)}),{code:'vcs/ref-stale'});});
