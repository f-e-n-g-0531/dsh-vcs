import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createLocalTag} from '../git-tag-create.mjs';
import {encodeGitTag} from '../src/git-tag-object.mjs';
import {deflateSync} from 'node:zlib';
import {withOperationBudget} from '../src/operation-budget.mjs';

async function fixture(t,format='sha1'){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-ref-test-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'}}).trim();
  git('init','-q','--object-format='+format,'-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@localhost');
  await fs.writeFile(path.join(root,'file'),'one\n');git('add','file');git('commit','-qm','old');const old=git('rev-parse','HEAD');
  await fs.writeFile(path.join(root,'file'),'two\n');git('add','file');git('commit','-qm','new');const next=git('rev-parse','HEAD');git('update-ref','refs/heads/main',old,next);
  const tag=encodeGitTag({object:next,tag:'topic/nested',tagger:{name:'Tagger',email:'tagger@localhost',timestamp:1234567890,timezone:'+0000'},message:'release'},{objectFormat:format});
  const put=(type,body)=>execFileSync('git',['-C',root,'hash-object','-t',type,'-w','--stdin'],{input:body,encoding:'utf8',windowsHide:true}).trim();
  assert.equal(put('tag',tag.body),tag.oid);
  return {root,git,old,next,tag,put,repo:{type:'git',root},options:{ref:'refs/tags/topic/nested',expectedTagOid:tag.oid,objectFormat:format,assertAuthorized(){},onStart(){}}};
}
async function snapshot(root){
  const out={};async function visit(p,rel){for(const name of await fs.readdir(p)){const r=rel?rel+'/'+name:name,f=path.join(p,name),s=await fs.lstat(f);if(s.isDirectory()){out[r+'/']='directory';await visit(f,r);}else out[r]=(await fs.readFile(f)).toString('hex');}}await visit(root,'');return out;
}
for(const format of ['sha1','sha256'])test('real '+format+' CAS changes only tag/reflogs and suppresses reference hooks',async t=>{
  const f=await fixture(t,format),marker=path.join(f.root,'HOOK-RAN');
  await fs.writeFile(path.join(f.root,'.git','hooks','reference-transaction'),'#!/bin/sh\necho bad > "'+marker.replaceAll('\\','/')+'"\nexit 1\n',{mode:0o755});
  f.git('config','core.hooksPath',path.join(f.root,'.git','hooks'));
  f.git('config','core.logAllRefUpdates','always');
  f.git('config','committer.name','Untrusted');f.git('config','committer.email','untrusted@example.invalid');
  const before=await snapshot(f.root);let starts=0;
  assert.deepEqual(await createLocalTag(f.repo,{...f.options,onStart(){starts++;}}),{ref:'refs/tags/topic/nested',tagOid:f.tag.oid,commit:f.next});
  assert.equal(starts,1);assert.equal(f.git('rev-parse','HEAD'),f.old);assert.equal(sync.existsSync(marker),false);
  const after=await snapshot(f.root),changed=Object.keys({...before,...after}).filter(k=>before[k]!==after[k]).sort();
  assert.deepEqual(changed,['.git/logs/refs/tags/','.git/logs/refs/tags/topic/','.git/logs/refs/tags/topic/nested','.git/refs/tags/topic/','.git/refs/tags/topic/nested']);
  const log=await fs.readFile(path.join(f.root,'.git','logs','refs','tags','topic','nested'),'utf8');assert.match(log,/Dsh <dsh@localhost>.*dsh: create local tag/);
});
for(const bad of ['HEAD','refs/heads/x','refs/tags/../x','refs/tags/x.lock','refs/tags/x y','refs/tags/x\\y','refs/tags/x[','refs/tags/a@{x','refs/tags/CON'])test('reject exact unsafe ref '+bad,async t=>{const f=await fixture(t);await assert.rejects(createLocalTag(f.repo,{...f.options,ref:bad}),{code:'vcs/tag-create-invalid'});});
for(const relative of ['packed-refs','commondir','worktrees','reftable','refs/heads/main.lock','logs/HEAD.lock','objects/info/alternates','sharedindex.bad'])test('reject unsupported metadata '+relative,async t=>{const f=await fixture(t),p=path.join(f.root,'.git',relative);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,'unsupported');await assert.rejects(createLocalTag(f.repo,f.options),{code:'vcs/tag-create-unsupported'});assert.equal((await fs.readFile(path.join(f.root,'.git','refs','heads','main'),'utf8')).trim(),f.old);});
test('include config rejected before expanded config is read',async t=>{const f=await fixture(t);f.git('config','include.path',path.join(f.root,'missing-config'));await assert.rejects(createLocalTag(f.repo,f.options),{code:'vcs/tag-create-unsupported'});});
test('detached HEAD rejected',async t=>{const f=await fixture(t);f.git('checkout','--detach','-q',f.old);await assert.rejects(createLocalTag(f.repo,f.options),{code:'vcs/tag-create-stale'});});
test('tag object must really be a tag',async t=>{const f=await fixture(t),tree=f.git('rev-parse','HEAD^{tree}');await definite(f,{expectedTagOid:tree});});
test('missing new object fails before start',async t=>{const f=await fixture(t);let started=false;await assert.rejects(createLocalTag(f.repo,{...f.options,expectedTagOid:'1'.repeat(40),onStart(){started=true;}}));assert.equal(started,false);});
test('pre-abort never starts',async t=>{const f=await fixture(t),c=new AbortController();c.abort();let started=false;await assert.rejects(createLocalTag(f.repo,{...f.options,signal:c.signal,onStart(){started=true;}}));assert.equal(started,false);});
test('pre-start authorization revocation stays definite',async t=>{const f=await fixture(t);let n=0;await assert.rejects(createLocalTag(f.repo,{...f.options,assertAuthorized(){if(++n===2)throw Error('revoked');}}),/revoked/);assert.equal(f.git('rev-parse','HEAD'),f.old);});
test('post-start abort is conservative outcome unknown',async t=>{const f=await fixture(t),c=new AbortController();await assert.rejects(createLocalTag(f.repo,{...f.options,signal:c.signal,onStart(){c.abort();}}),e=>e.code==='vcs/tag-create-outcome-unknown'&&e.outcomeUnknown===true);assert.equal(f.git('rev-parse','HEAD'),f.old);});
test('onStart throw is outcome unknown',async t=>{const f=await fixture(t);await assert.rejects(createLocalTag(f.repo,{...f.options,onStart(){throw Error('start failure');}}),{code:'vcs/tag-create-outcome-unknown',outcomeUnknown:true});});
test('post-write auth revocation does not roll back ref',async t=>{const f=await fixture(t);let n=0;await assert.rejects(createLocalTag(f.repo,{...f.options,assertAuthorized(){if(++n===3)throw Error('revoked');}}),{code:'vcs/tag-create-outcome-unknown',outcomeUnknown:true});assert.equal(f.git('rev-parse',f.options.ref),f.tag.oid);assert.equal(f.git('rev-parse','HEAD'),f.old);});
test('shared outer deadline is not reset',async t=>{const f=await fixture(t);await assert.rejects(withOperationBudget({timeoutMs:1},()=>createLocalTag(f.repo,f.options)),{code:'TIMEOUT'});assert.equal(f.git('rev-parse','HEAD'),f.old);});
test('async onStart rejected as unknown without mutation',async t=>{const f=await fixture(t);await assert.rejects(createLocalTag(f.repo,{...f.options,async onStart(){}}),{code:'vcs/tag-create-outcome-unknown',outcomeUnknown:true});assert.equal(f.git('rev-parse','HEAD'),f.old);});
for(const relative of ['refs/heads/main','logs/HEAD'])test('hardlinked metadata rejected '+relative,async t=>{const f=await fixture(t);await fs.link(path.join(f.root,'.git',relative),path.join(f.root,'foreign-link'));await assert.rejects(createLocalTag(f.repo,f.options),{code:'vcs/tag-create-unsafe'});});
test('linked refs directory rejected',async t=>{const f=await fixture(t),refs=path.join(f.root,'.git','refs'),saved=path.join(f.root,'saved-refs');await fs.rename(refs,saved);await fs.symlink(saved,refs,process.platform==='win32'?'junction':'dir');await assert.rejects(createLocalTag(f.repo,f.options),{code:'vcs/tag-create-unsafe'});});
test('owned hooks directory cleaned after success',async t=>{const f=await fixture(t),temp=await fs.realpath(os.tmpdir()),before=new Set(await fs.readdir(temp));let owned;await createLocalTag(f.repo,{...f.options,onStart(){owned=sync.readdirSync(temp).filter(n=>n.startsWith('dsh-tag-create-hooks-'+process.pid+'-')&&!before.has(n));assert.equal(owned.length,1);}});assert.equal(sync.existsSync(path.join(temp,owned[0])),false);});
test('foreign hook entries retained on aborted cleanup',async t=>{const f=await fixture(t),c=new AbortController(),temp=await fs.realpath(os.tmpdir()),before=new Set(await fs.readdir(temp));let owned;await assert.rejects(createLocalTag(f.repo,{...f.options,signal:c.signal,onStart(){const names=sync.readdirSync(temp).filter(n=>n.startsWith('dsh-tag-create-hooks-'+process.pid+'-')&&!before.has(n));assert.equal(names.length,1);owned=path.join(temp,names[0]);sync.writeFileSync(path.join(owned,'foreign'),'retain');c.abort();}}),{code:'vcs/tag-create-outcome-unknown',outcomeUnknown:true});t.after(()=>fs.rm(owned,{recursive:true,force:true}));assert.equal(await fs.readFile(path.join(owned,'foreign'),'utf8'),'retain');});
test('config worktree redirect rejected',async t=>{const f=await fixture(t);f.git('config','core.worktree',f.root);await assert.rejects(createLocalTag(f.repo,f.options),{code:'vcs/tag-create-unsupported'});});

for(const commit of ['0'.repeat(40),'abcd','A'.repeat(40),'1'.repeat(64)])test('reject invalid commit '+commit,async t=>{const f=await fixture(t);await assert.rejects(createLocalTag(f.repo,{...f.options,expectedTagOid:commit}),{code:'vcs/tag-create-invalid'});});
for(const ref of ['refs/tags/','refs/tags/a//b','refs/tags/a\ud800','refs/tags/x.','refs/tags/.bad'])test('reject strict ref '+JSON.stringify(ref),async t=>{const f=await fixture(t);await assert.rejects(createLocalTag(f.repo,{...f.options,ref}),{code:'vcs/tag-create-invalid'});});
test('symbolic target rejected before start',async t=>{const f=await fixture(t);f.git('symbolic-ref',f.options.ref,'refs/heads/main');let started=false;await assert.rejects(createLocalTag(f.repo,{...f.options,onStart(){started=true;}}),{code:'vcs/tag-create-exists'});assert.equal(started,false);});
test('competing create at onStart fails zero-old CAS and retains competitor',async t=>{const f=await fixture(t);await assert.rejects(createLocalTag(f.repo,{...f.options,onStart(){f.git('update-ref',f.options.ref,f.old,'0'.repeat(40));}}),{code:'vcs/tag-create-outcome-unknown',outcomeUnknown:true});assert.equal(f.git('rev-parse',f.options.ref),f.old);assert.equal(f.git('rev-parse','HEAD'),f.old);});
test('HEAD change during final pre-start authorization is detected',async t=>{const f=await fixture(t);let n=0,started=false;await assert.rejects(createLocalTag(f.repo,{...f.options,assertAuthorized(){if(++n===2)f.git('update-ref','refs/heads/main',f.next,f.old);},onStart(){started=true;}}),{code:'vcs/tag-create-stale'});assert.equal(started,false);});
test('unborn HEAD rejected before start',async t=>{const f=await fixture(t);f.git('symbolic-ref','HEAD','refs/heads/unborn');let started=false;await assert.rejects(createLocalTag(f.repo,{...f.options,onStart(){started=true;}}));assert.equal(started,false);});
test('missing index is allowed and stays missing',async t=>{const f=await fixture(t);await fs.unlink(path.join(f.root,'.git','index'));await createLocalTag(f.repo,f.options);assert.equal(sync.existsSync(path.join(f.root,'.git','index')),false);});
test('index change in final authorization is rejected before start',async t=>{const f=await fixture(t);let n=0,started=false;await assert.rejects(createLocalTag(f.repo,{...f.options,assertAuthorized(){if(++n===2)sync.appendFileSync(path.join(f.root,'.git','index'),'x');},onStart(){started=true;}}),{code:'vcs/tag-create-stale'});assert.equal(started,false);});
test('post-start index change is unknown and not reverted',async t=>{const f=await fixture(t);await assert.rejects(createLocalTag(f.repo,{...f.options,onStart(){sync.appendFileSync(path.join(f.root,'.git','index'),'x');}}),{code:'vcs/tag-create-outcome-unknown',outcomeUnknown:true});assert.equal(f.git('rev-parse',f.options.ref),f.tag.oid);});
for(const collision of [false,true])test('actual packed refs fail closed collision='+collision,async t=>{const f=await fixture(t);if(collision)f.git('update-ref',f.options.ref,f.old);f.git('pack-refs','--all','--prune');let started=false;const before=await snapshot(f.root);await assert.rejects(createLocalTag(f.repo,{...f.options,onStart(){started=true;}}),{code:'vcs/tag-create-unsupported'});assert.equal(started,false);assert.deepEqual(await snapshot(f.root),before);});
test('thenable start rejection is unknown and no target is created',async t=>{const f=await fixture(t);await assert.rejects(createLocalTag(f.repo,{...f.options,onStart(){return Promise.reject(Error('rejected start'));}}),{code:'vcs/tag-create-outcome-unknown',outcomeUnknown:true});assert.equal(sync.existsSync(path.join(f.root,'.git',f.options.ref)),false);});
test('invalid format is rejected without start',async t=>{const f=await fixture(t);await assert.rejects(createLocalTag(f.repo,{...f.options,objectFormat:'SHA1'}),{code:'vcs/tag-create-invalid'});});
test('pre-start auth rejection has no unknown flag and no mutation',async t=>{const f=await fixture(t),before=await snapshot(f.root);await assert.rejects(createLocalTag(f.repo,{...f.options,assertAuthorized(){throw Error('revoked');}}),e=>e.message==='revoked'&&!e.outcomeUnknown);assert.deepEqual(await snapshot(f.root),before);});

const unknown={code:'vcs/tag-create-outcome-unknown',outcomeUnknown:true};
async function definite(f,options={}){let started=false;await assert.rejects(createLocalTag(f.repo,{...f.options,...options,onStart(){started=true;}}),e=>!e.outcomeUnknown);assert.equal(started,false);}
for(const kind of ['exact','prefix','descendant','case','log','logprefix','logcase'])test('target collision '+kind,async t=>{
 const f=await fixture(t);let rel=kind==='log'?'logs/'+f.options.ref:kind==='logprefix'?'logs/refs/tags/topic':kind==='logcase'?'logs/refs/tags/Topic/other':kind==='prefix'?'refs/tags/topic':kind==='descendant'?f.options.ref+'/child':kind==='case'?'refs/tags/Topic/other':f.options.ref;
 await fs.mkdir(path.dirname(path.join(f.root,'.git',rel)),{recursive:true});await fs.writeFile(path.join(f.root,'.git',rel),f.old+'\n');await definite(f);
});
test('tag name must match parsed tag exactly',async t=>{const f=await fixture(t);await definite(f,{ref:'refs/tags/Topic/nested'});});
for(const kind of ['signedtag','signedcommit','missingcommit','wrongtype','corrupttag','corruptcommit'])test('authenticated existing objects reject '+kind+' before start',async t=>{
 const f=await fixture(t);let oid=f.tag.oid;
 if(kind==='signedtag')oid=f.put('tag',Buffer.concat([f.tag.body,Buffer.from('\n-----BEGIN PGP SIGNATURE-----\nx')]));
 if(['signedcommit','missingcommit','wrongtype'].includes(kind)){
  let object='1'.repeat(40);
  if(kind==='signedcommit'){const raw=execFileSync('git',['-C',f.root,'cat-file','commit',f.next]);object=f.put('commit',Buffer.from(raw.toString().replace('\n\n','\ngpgsig signature\n\n')));}
  if(kind==='wrongtype')object=f.git('rev-parse','HEAD^{tree}');
  oid=f.put('tag',encodeGitTag({object,tag:'topic/nested',tagger:{name:'Tagger',email:'tagger@localhost',timestamp:1,timezone:'+0000'},message:'release'}).body);
 }
 if(kind.startsWith('corrupt')){const target=kind==='corrupttag'?oid:f.next;const p=path.join(f.root,'.git','objects',target.slice(0,2),target.slice(2));const body=kind==='corrupttag'?Buffer.from(f.tag.body):execFileSync('git',['-C',f.root,'cat-file','commit',f.next]);body[body.length-1]^=1;await fs.chmod(p,0o644);await fs.writeFile(p,deflateSync(Buffer.concat([Buffer.from((kind==='corrupttag'?'tag':'commit')+' '+body.length+'\0'),body])));}
 await definite(f,{expectedTagOid:oid});
});
test('final pre-start re-read authenticates object body again',async t=>{const f=await fixture(t);let n=0;await definite(f,{assertAuthorized(){if(++n===2){const p=path.join(f.root,'.git','objects',f.tag.oid.slice(0,2),f.tag.oid.slice(2));sync.chmodSync(p,0o644);sync.writeFileSync(p,'corrupt');}}});});
for(const target of ['refs/heads/main','refs/heads/missing'])test('current Git zero-old no-deref rejects raced symbolic target '+target,async t=>{const f=await fixture(t);t.diagnostic(f.git('--version'));await assert.rejects(createLocalTag(f.repo,{...f.options,onStart(){f.git('symbolic-ref',f.options.ref,target);}}),unknown);assert.equal(f.git('symbolic-ref',f.options.ref),target);assert.equal(sync.existsSync(path.join(f.root,'.git','refs/heads/missing')),false);assert.equal(f.git('rev-parse','HEAD'),f.old);});
test('optional absent HEAD logs and index remain absent',async t=>{const f=await fixture(t);await fs.rm(path.join(f.root,'.git','logs'),{recursive:true});await fs.unlink(path.join(f.root,'.git','index'));await createLocalTag(f.repo,f.options);assert.equal(sync.existsSync(path.join(f.root,'.git','logs')),false);assert.equal(sync.existsSync(path.join(f.root,'.git','index')),false);});
test('existing HEAD reflog content pinned before start',async t=>{const f=await fixture(t);let n=0;await definite(f,{assertAuthorized(){if(++n===2)sync.appendFileSync(path.join(f.root,'.git','logs','HEAD'),'changed');}});});
for(const short of ['HEAD','@','-x','refs/x','x<y','x|y','x\u200by','x'.repeat(256),Array(5).fill('x'.repeat(201)).join('/')])test('portable tag name bound '+short.slice(0,30),async t=>{const f=await fixture(t);await definite(f,{ref:'refs/tags/'+short});});
test('post-start target overwrite retained and reported unknown',async t=>{const f=await fixture(t);let n=0;await assert.rejects(createLocalTag(f.repo,{...f.options,assertAuthorized(){if(++n===3)f.git('update-ref',f.options.ref,f.old,f.tag.oid);}}),unknown);assert.equal(f.git('rev-parse',f.options.ref),f.old);});
test('post-start HEAD change retained and reported unknown',async t=>{const f=await fixture(t);await assert.rejects(createLocalTag(f.repo,{...f.options,onStart(){f.git('update-ref','refs/heads/main',f.next,f.old);}}),unknown);assert.equal(f.git('rev-parse','HEAD'),f.next);assert.equal(f.git('rev-parse',f.options.ref),f.tag.oid);});
test('invalid post-create tag reflog rejected without rollback',async t=>{const f=await fixture(t);let n=0;await assert.rejects(createLocalTag(f.repo,{...f.options,assertAuthorized(){if(++n===3){const p=path.join(f.root,'.git','logs',f.options.ref);sync.mkdirSync(path.dirname(p),{recursive:true});sync.writeFileSync(p,'bad log');}}}),unknown);assert.equal(f.git('rev-parse',f.options.ref),f.tag.oid);});
test('Unicode exact tag name works',async t=>{const f=await fixture(t),tag=encodeGitTag({object:f.next,tag:'功能/🚀',tagger:{name:'Tagger',email:'tagger@localhost',timestamp:1,timezone:'+0000'},message:'release'}),oid=f.put('tag',tag.body);await createLocalTag(f.repo,{...f.options,ref:'refs/tags/功能/🚀',expectedTagOid:oid});assert.equal(f.git('rev-parse','refs/tags/功能/🚀'),oid);});
