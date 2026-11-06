import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as sync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {deflateSync} from 'node:zlib';
import {setTimeout as delay} from 'node:timers/promises';
import {createLightweightTag} from '../git-lightweight-tag-create.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';

const unknown={code:'vcs/lightweight-tag-create-outcome-unknown',outcomeUnknown:true};
async function fixture(t,format='sha1'){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-lightweight-ref-test-')));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'};
  const raw=(args,input)=>execFileSync('git',['-C',root,...args],{input,windowsHide:true,env,stdio:['pipe','pipe','pipe']});
  const git=(...args)=>raw(args).toString().trim();
  git('init','-q','--object-format='+format,'-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@localhost');
  await fs.writeFile(path.join(root,'file'),'one\n');git('add','file');git('commit','-qm','old');const old=git('rev-parse','HEAD');
  await fs.writeFile(path.join(root,'file'),'two\n');git('add','file');git('commit','-qm','next');const next=git('rev-parse','HEAD');
  git('update-ref','refs/heads/main',old,next);
  const put=(type,body)=>raw(['hash-object','-t',type,'-w','--stdin'],body).toString().trim();
  return {root,git,raw,put,old,next,repo:{type:'git',root},options:{ref:'refs/tags/topic/nested',expectedCommitOid:next,objectFormat:format,assertAuthorized(){},onStart(){}}};
}
async function snapshot(root){
  const rows={};
  async function visit(p,rel){for(const name of (await fs.readdir(p)).sort()){const r=rel?rel+'/'+name:name,f=path.join(p,name),s=await fs.lstat(f);if(s.isDirectory()){rows[r+'/']='directory';await visit(f,r);}else rows[r]=(await fs.readFile(f)).toString('hex');}}
  await visit(root,'');return rows;
}
async function definite(f,overrides={},code){
  const before=await snapshot(f.root);let starts=0;
  await assert.rejects(createLightweightTag(f.repo,{...f.options,...overrides,onStart(){starts++;}}),e=>!e.outcomeUnknown&&(!code||e.code===code));
  assert.equal(starts,0);assert.deepEqual(await snapshot(f.root),before);
}
for(const format of ['sha1','sha256'])test('real '+format+' creates a direct commit tag only; dirty HEAD/index/worktree and objects unchanged',async t=>{
  const f=await fixture(t,format),marker=path.join(f.root,'HOOK-RAN');
  await fs.writeFile(path.join(f.root,'.git','hooks','reference-transaction'),'#!/bin/sh\necho bad > "'+marker.replaceAll('\\','/')+'"\nexit 1\n',{mode:0o755});
  f.git('config','core.hooksPath',path.join(f.root,'.git','hooks'));f.git('config','core.logAllRefUpdates','always');
  f.git('config','committer.name','Untrusted');f.git('config','committer.email','untrusted@example.invalid');
  await fs.writeFile(path.join(f.root,'file'),'staged\n');f.git('add','file');
  await fs.writeFile(path.join(f.root,'file'),'dirty\n');await fs.writeFile(path.join(f.root,'untracked'),'keep\n');
  const before=await snapshot(f.root);let starts=0;
  assert.deepEqual(await createLightweightTag(f.repo,{...f.options,onStart(){starts++;}}),{ref:f.options.ref,commit:f.next});
  assert.equal(starts,1);assert.equal(f.git('rev-parse','HEAD'),f.old);
  assert.equal(await fs.readFile(path.join(f.root,'.git',f.options.ref),'utf8'),f.next+'\n');
  assert.equal(f.git('cat-file','-t',f.options.ref),'commit');assert.equal(sync.existsSync(marker),false);
  const after=await snapshot(f.root),changed=Object.keys({...before,...after}).filter(k=>before[k]!==after[k]).sort();
  assert.deepEqual(changed,['.git/logs/refs/tags/','.git/logs/refs/tags/topic/','.git/logs/refs/tags/topic/nested','.git/refs/tags/topic/','.git/refs/tags/topic/nested']);
  assert.match(await fs.readFile(path.join(f.root,'.git','logs',f.options.ref),'utf8'),new RegExp('^'+'0'.repeat(f.next.length)+' '+f.next+' Dsh <dsh@localhost> [0-9]+ [+-][0-9]{4}\\tdsh: create lightweight tag\\n$'));
});
for(const kind of ['exact','prefix','descendant','case','log','logprefix','logdescendant','logcase','symbolic','dangling'])test('collision before start preserves '+kind,async t=>{
  const f=await fixture(t);
  if(kind==='symbolic'||kind==='dangling')f.git('symbolic-ref',f.options.ref,kind==='symbolic'?'refs/heads/main':'refs/heads/missing');
  else {const relative=({exact:f.options.ref,prefix:'refs/tags/topic',descendant:f.options.ref+'/child',case:'refs/tags/Topic/other',log:'logs/'+f.options.ref,logprefix:'logs/refs/tags/topic',logdescendant:'logs/'+f.options.ref+'/child',logcase:'logs/refs/tags/Topic/other'})[kind];const p=path.join(f.root,'.git',relative);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,f.old+'\n');}
  await definite(f,{},'vcs/lightweight-tag-create-exists');
});
for(const format of ['sha1','sha256'])for(const kind of ['tag','tree','blob','missing','corrupt','signedcommit'])test(format+' expected '+kind+' rejects before start without writes',async t=>{
  const f=await fixture(t,format);let oid=f.next;
  if(kind==='tag')oid=f.put('tag',Buffer.from('object '+f.next+'\ntype commit\ntag release\ntagger Fixture <fixture@localhost> 1234567890 +0000\n\nrelease\n'));
  if(kind==='tree')oid=f.git('rev-parse',f.next+'^{tree}');
  if(kind==='blob')oid=f.git('rev-parse',f.next+':file');
  if(kind==='missing')oid='1'.repeat(f.next.length);
  if(kind==='signedcommit')oid=f.put('commit',Buffer.from(f.raw(['cat-file','commit',f.next]).toString().replace('\n\n','\ngpgsig signature\n continuation\n\n')));
  if(kind==='corrupt'){const p=path.join(f.root,'.git','objects',oid.slice(0,2),oid.slice(2)),body=f.raw(['cat-file','commit',oid]);body[body.length-1]^=1;await fs.chmod(p,0o644);await fs.writeFile(p,deflateSync(Buffer.concat([Buffer.from('commit '+body.length+'\0'),body])));}
  await definite(f,{expectedCommitOid:oid});
});
test('strict refs, Unicode surrogates and invalid exact OIDs never start',async t=>{
  const f=await fixture(t);
  const refs=['HEAD','refs/heads/x','refs/tags/','refs/tags/@','refs/tags/HEAD','refs/tags/-x','refs/tags/refs/x','refs/tags/../x','refs/tags/a//b','refs/tags/.x','refs/tags/x.','refs/tags/a.LOCK','refs/tags/CON','refs/tags/x y','refs/tags/x\\y','refs/tags/x[','refs/tags/a@{x','refs/tags/x<y','refs/tags/x|y','refs/tags/x\u200by','refs/tags/x\ud800','refs/tags/x\udc00','refs/tags/'+'x'.repeat(256),'refs/tags/'+Array(5).fill('x'.repeat(201)).join('/')];
  for(const ref of refs)await definite(f,{ref},'vcs/lightweight-tag-create-invalid');
  for(const expectedCommitOid of ['0'.repeat(40),'abcd','A'.repeat(40),'1'.repeat(64)])await definite(f,{expectedCommitOid},'vcs/lightweight-tag-create-invalid');
  await definite(f,{objectFormat:'SHA1'},'vcs/lightweight-tag-create-invalid');
});
for(const key of ['include.path','includeIf.gitdir:/.path'])test('config '+key+' guard does not expand malformed include',async t=>{
  const f=await fixture(t),p=path.join(f.root,'poison-config');await fs.writeFile(p,'[broken\n');f.git('config',key,p);
  await definite(f,{},'vcs/lightweight-tag-create-unsupported');
});
test('pre-aborted cancellation is definite and never starts',async t=>{const f=await fixture(t),c=new AbortController();c.abort(Error('cancel'));await definite(f,{signal:c.signal});});
for(const when of [1,2])test('authorization rejection at pre-start checkpoint '+when+' is definite',async t=>{const f=await fixture(t);let calls=0;await definite(f,{assertAuthorized(){if(++calls===when)throw Error('revoked');}});assert.equal(calls,when);});
test('cancellation during final authorization is definite',async t=>{const f=await fixture(t),c=new AbortController();let calls=0;await definite(f,{signal:c.signal,assertAuthorized(){if(++calls===2)c.abort();}});});
for(const kind of ['abort','throw','async','thenable'])test('post-notification '+kind+' is outcome unknown without ref write',async t=>{
  const f=await fixture(t),c=new AbortController(),before=await snapshot(f.root);let starts=0;
  await assert.rejects(createLightweightTag(f.repo,{...f.options,signal:c.signal,onStart(){starts++;if(kind==='abort')c.abort();if(kind==='throw')throw Error('start failure');if(kind==='async')return Promise.reject(Error('start rejection'));if(kind==='thenable')return {then(resolve){resolve();}};}}),unknown);
  assert.equal(starts,1);assert.deepEqual(await snapshot(f.root),before);
});
for(const when of [3,4])test('post-write auth revocation '+when+' retains created tag and is unknown',async t=>{const f=await fixture(t);let calls=0,starts=0;await assert.rejects(createLightweightTag(f.repo,{...f.options,assertAuthorized(){if(++calls===when)throw Error('revoked');},onStart(){starts++;}}),unknown);assert.equal(starts,1);assert.equal(f.git('rev-parse',f.options.ref),f.next);assert.equal(f.git('rev-parse','HEAD'),f.old);});
test('post-write cancellation retains tag and reports unknown',async t=>{const f=await fixture(t),c=new AbortController();let calls=0;await assert.rejects(createLightweightTag(f.repo,{...f.options,signal:c.signal,assertAuthorized(){if(++calls===3)c.abort();}}),unknown);assert.equal(f.git('rev-parse',f.options.ref),f.next);});
for(const format of ['sha1','sha256'])test(format+' competitor direct OID at onStart is never overwritten',async t=>{
  const f=await fixture(t,format);let starts=0;
  await assert.rejects(createLightweightTag(f.repo,{...f.options,onStart(){starts++;f.git('update-ref',f.options.ref,f.old,'0'.repeat(f.old.length));}}),unknown);
  assert.equal(starts,1);assert.equal(f.git('rev-parse',f.options.ref),f.old);assert.equal(f.git('rev-parse','HEAD'),f.old);
});
for(const target of ['refs/heads/main','refs/heads/missing'])test('current Git refuses raced symbolic '+target+' and preserves destination',async t=>{
  const f=await fixture(t);t.diagnostic(f.git('--version'));
  await assert.rejects(createLightweightTag(f.repo,{...f.options,onStart(){f.git('symbolic-ref',f.options.ref,target);}}),unknown);
  assert.equal(f.git('symbolic-ref',f.options.ref),target);assert.equal(f.git('rev-parse','HEAD'),f.old);
  assert.equal(sync.existsSync(path.join(f.root,'.git','refs/heads/missing')),false);
});
test('expired shared budget is not reset and never starts',async t=>{
  const f=await fixture(t),before=await snapshot(f.root);let starts=0;
  await assert.rejects(withOperationBudget({timeoutMs:5},async()=>{await delay(20);return createLightweightTag(f.repo,{...f.options,onStart(){starts++;}});}),{code:'TIMEOUT'});
  assert.equal(starts,0);assert.deepEqual(await snapshot(f.root),before);
});
test('shared budget expiring inside authorization remains definite',async t=>{
  const f=await fixture(t),before=await snapshot(f.root);let starts=0;
  await assert.rejects(withOperationBudget({timeoutMs:20},()=>createLightweightTag(f.repo,{...f.options,async assertAuthorized(){await delay(40);},onStart(){starts++;}})),{code:'TIMEOUT'});
  assert.equal(starts,0);assert.deepEqual(await snapshot(f.root),before);
});
