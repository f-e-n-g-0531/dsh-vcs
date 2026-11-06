import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {git} from '../local-command.mjs';
import {listChanges} from '../vcs.mjs';
import {parseGitIndex} from '../src/git-index.mjs';
import * as api from '../index-change.mjs';

const spawn=cp.spawn;
cp.spawn=(command,args,options)=>spawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-line-absent-global')}});
syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
const hooks={assertAuthorized(){},onStart(){}};
const I='start\nindex1\nindex2\nend\n',H='start\nhead1\nhead2\nend\n',W='start\nwork1\nwork2\nend\n';
async function fixture(t,{head=H,index=I,work=W,format='sha1'}={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-line-selection-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const run=(...a)=>git(root,a),write=(p,b)=>fs.writeFile(path.join(root,p),b),repo={type:'git',root};
 await run('init','--object-format='+format);
 for(const[k,v]of [['user.name','Line Test'],['user.email','line@example.invalid'],['core.autocrlf','false'],['core.safecrlf','false'],['commit.gpgsign','false']])await run('config',k,v);
 await write('selected.txt',head);await write('other.txt','base\n');await run('add','.');await run('commit','-m','base');
 await write('selected.txt',index);await write('other.txt','other staged\n');await run('add','.');
 await write('selected.txt',work);await write('other.txt','other work\n');
 const raw=()=>fs.readFile(path.join(root,'.git','index'));
 const id=async(direction)=>{const entry=(await listChanges(repo,direction==='stage'?'unstaged':'staged')).find(e=>e.path==='selected.txt');assert.ok(entry);return entry.id;};
 const entries=async()=>parseGitIndex(await raw(),{objectFormat:format}).entries;
 const objects=()=>fs.readdir(path.join(root,'.git','objects'),{recursive:true});
 return {root,repo,run,write,raw,id,entries,objects,head,index,work};
}
const prepare=async(f,d)=>api[d==='stage'?'prepareLineIndexStage':'prepareLineIndexUnstage'](f.repo,{id:await f.id(d)});
const select=(f,d,p,ids)=>api[d==='stage'?'selectLineIndexStage':'selectLineIndexUnstage'](f.repo,{snapshot:p,operationIds:ids??[p.plan.operations[0].id]});
const apply=(f,d,s,extra={})=>api[d==='stage'?'applyLineIndexStage':'applyLineIndexUnstage'](f.repo,{snapshot:s,...hooks,...extra});
async function preserved(f,entries,head){
 assert.deepEqual((await f.entries()).filter(e=>e.path!=='selected.txt'),entries.filter(e=>e.path!=='selected.txt'));
 assert.deepEqual(await f.run('rev-parse','HEAD'),head);
 assert.deepEqual(await fs.readFile(path.join(f.root,'selected.txt')),Buffer.from(f.work));
 assert.deepEqual(await fs.readFile(path.join(f.root,'other.txt')),Buffer.from('other work\n'));
}
for(const format of ['sha1','sha256'])for(const direction of ['stage','unstage'])for(const choice of ['delete','insert','mixed'])test(format+' '+direction+' '+choice+' subset within one replacement',async t=>{
 const f=await fixture(t,{format}),entries=await f.entries(),head=await f.run('rev-parse','HEAD'),p=await prepare(f,direction);
 assert.equal(p.plan.units.length,1);assert.equal(p.plan.operations.length,4);assert.ok(Object.isFrozen(p.plan.operations));
 assert.deepEqual(p.plan.operations.map(o=>[o.kind,o.text]),[['delete','index1'],['delete','index2'],['insert',direction==='stage'?'work1':'head1'],['insert',direction==='stage'?'work2':'head2']]);
 const ids=choice==='delete'?[p.plan.operations[0].id]:choice==='insert'?[p.plan.operations[2].id]:[p.plan.operations[3].id,p.plan.operations[0].id];
 const s=await select(f,direction,p,ids);assert.deepEqual(s.operationIds,ids);assert.ok(Object.isFrozen(s.operationIds));
 await apply(f,direction,s);
 const expected=choice==='delete'?'start\nindex2\nend\n':choice==='insert'?(direction==='stage'?'start\nindex1\nindex2\nwork1\nend\n':'start\nindex1\nindex2\nhead1\nend\n'):(direction==='stage'?'start\nindex2\nwork2\nend\n':'start\nindex2\nhead2\nend\n');
 assert.deepEqual(await f.run('show',':selected.txt'),Buffer.from(expected));await preserved(f,entries,head);
});
for(const direction of ['stage','unstage'])test(direction+' all operations exact raw BOM mixed EOL and EOF',async t=>{
 const f=await fixture(t,{head:'﻿head\r\nanchor\nold',index:'﻿index\r\nanchor\nindex',work:'﻿work\r\nanchor\nwork'}),p=await prepare(f,direction);
 await apply(f,direction,await select(f,direction,p,p.plan.operations.map(o=>o.id)));
 assert.deepEqual(await f.run('show',':selected.txt'),Buffer.from(direction==='stage'?f.work:f.head));
 assert.deepEqual(await fs.readFile(path.join(f.root,'selected.txt')),Buffer.from(f.work));
});
for(const direction of ['stage','unstage'])test(direction+' LINE vs BLOCK vs whole vs opposite direction capabilities',async t=>{
 const f=await fixture(t),p=await prepare(f,direction),opposite=direction==='stage'?'unstage':'stage',before=await f.raw();
 for(const clone of [{...p},JSON.parse(JSON.stringify(p))])await assert.rejects(select(f,direction,clone));
 await assert.rejects(select(f,opposite,p));
 const block=await api[direction==='stage'?'preparePartialIndexStage':'preparePartialIndexUnstage'](f.repo,{id:await f.id(direction)});
 await assert.rejects(select(f,direction,block,[p.plan.operations[0].id]));
 await assert.rejects(api[direction==='stage'?'selectPartialIndexStage':'selectPartialIndexUnstage'](f.repo,{snapshot:p,unitIds:[p.plan.units[0].id]}));
 const s=await select(f,direction,p);
 for(const publish of [api.applyIndexStage,api.applyIndexUnstage,api.applyPartialIndexUnstage])await assert.rejects(publish(f.repo,{snapshot:s,...hooks}));
 await assert.rejects(apply(f,opposite,s));await assert.rejects(apply(f,direction,{...s}));await assert.rejects(apply(f,direction,p));
 const blockGrant=await api[direction==='stage'?'selectPartialIndexStage':'selectPartialIndexUnstage'](f.repo,{snapshot:block,unitIds:[block.plan.units[0].id]});
 await assert.rejects(apply(f,direction,blockGrant));assert.deepEqual(await f.raw(),before);
 await apply(f,direction,s); // Rejected cross-namespace attempts did not consume the real capability.
});
for(const direction of ['stage','unstage'])for(const phase of ['select','apply'])for(const mutation of ['index','work','head','other'])test(direction+' '+phase+' stale '+mutation,async t=>{
 const f=await fixture(t),p=await prepare(f,direction),s=phase==='apply'?await select(f,direction,p):null;
 if(mutation==='index')await f.run('add','other.txt');if(mutation==='work')await f.write('selected.txt',W+'foreign');if(mutation==='head')await f.run('commit','--allow-empty','-m','advance');if(mutation==='other')await f.write('other.txt','foreign');
 const before=await f.raw(),objects=await f.objects();let starts=0;
 await assert.rejects(phase==='select'?select(f,direction,p):apply(f,direction,s,{onStart(){starts++;}}));
 assert.equal(starts,0);assert.deepEqual(await f.raw(),before);assert.deepEqual(await f.objects(),objects);
});
for(const direction of ['stage','unstage'])test(direction+' invalid IDs are own-data only, single use, and copied before await',async t=>{
 const f=await fixture(t);let getters=0;
 for(const kind of ['empty','duplicate','unknown','number','hole','getter','inherited','extra','hidden']){
  const p=await prepare(f,direction),id=p.plan.operations[0].id;
  let ids=kind==='empty'?[]:kind==='duplicate'?[id,id]:kind==='unknown'?['unknown']:kind==='number'?[1]:kind==='hole'?new Array(1):[id];
  if(kind==='getter')Object.defineProperty(ids,'0',{get(){getters++;throw Error('must not invoke');}});
  if(kind==='inherited'){ids=new Array(1);Object.setPrototypeOf(ids,{0:id});}
  if(kind==='extra')ids.extra=id;
  if(kind==='hidden')Object.defineProperty(ids,'0',{value:id,enumerable:false});
  await assert.rejects(select(f,direction,p,ids));await assert.rejects(select(f,direction,p));
 }
 assert.equal(getters,0);
 const p=await prepare(f,direction),ids=[p.plan.operations[0].id],pending=select(f,direction,p,ids);ids[0]=p.plan.operations[1].id;
 const s=await pending;assert.deepEqual(s.operationIds,[p.plan.operations[0].id]);await apply(f,direction,s);
 assert.deepEqual(await f.run('show',':selected.txt'),Buffer.from('start\nindex2\nend\n'));
});
for(const direction of ['stage','unstage'])test(direction+' unsafe unterminated EOF insertion rejects read-only without fallback',async t=>{
 const f=await fixture(t,{head:'head',index:'index',work:'work'}),p=await prepare(f,direction),before=await f.raw(),objects=await f.objects();
 const insertion=p.plan.operations.find(o=>o.kind==='insert');
 await assert.rejects(select(f,direction,p,[insertion.id]),/merge raw line boundaries/);
 assert.deepEqual(await f.raw(),before);assert.deepEqual(await f.objects(),objects);
});
for(const direction of ['stage','unstage'])test(direction+' pre-start cancellation and authorization refusal are read-only',async t=>{
 const f=await fixture(t),p=await prepare(f,direction),s=await select(f,direction,p),before=await f.raw(),objects=await f.objects();let starts=0;
 const controller=new AbortController();controller.abort();
 await assert.rejects(apply(f,direction,s,{signal:controller.signal,onStart(){starts++;}}));
 await assert.rejects(apply(f,direction,s,{assertAuthorized(){throw Error('denied');},onStart(){starts++;}}));
 assert.equal(starts,0);assert.deepEqual(await f.raw(),before);assert.deepEqual(await f.objects(),objects);
});
for(const direction of ['stage','unstage'])for(const failure of ['cancel','metadata','authorization'])test(direction+' post-start '+failure+' is unknown',async t=>{
 const f=await fixture(t),p=await prepare(f,direction),s=await select(f,direction,p),before=await f.raw(),controller=new AbortController();let started=false;
 await assert.rejects(apply(f,direction,s,{signal:controller.signal,onStart(){started=true;if(failure==='cancel')controller.abort();},async assertAuthorized(){if(started){if(failure==='metadata')await f.write('.git/foreign-note','foreign');if(failure==='authorization')throw Error('revoked');}}}),e=>e.code==='vcs/index-outcome-unknown'&&e.outcomeUnknown&&e.appendOnly);
 assert.equal(started,true);assert.deepEqual(await f.raw(),before);
});
for(const direction of ['stage','unstage'])test(direction+' exact IDs required; wrong direction rejected; MM policy stays private',async t=>{
 const f=await fixture(t),prepareFn=api[direction==='stage'?'prepareLineIndexStage':'prepareLineIndexUnstage'];
 for(const id of [undefined,'selected.txt',await f.id(direction==='stage'?'unstage':'stage')])await assert.rejects(prepareFn(f.repo,{id}));
 for(const whole of [api.prepareIndexStage,api.prepareIndexUnstage])await assert.rejects(whole(f.repo,{path:'selected.txt',partialMM:true}));
});
for(const source of ['head','index','work'])test('fixed '+source+' byte bound fails read-only',async t=>{
 const f=await fixture(t,{[source]:'x'.repeat(256*1024+1)}),before=await f.raw(),objects=await f.objects();
 await assert.rejects(prepare(f,source==='head'?'unstage':'stage'));
 assert.deepEqual(await f.raw(),before);assert.deepEqual(await f.objects(),objects);
});
for(const direction of ['stage','unstage'])for(const limit of ['lines','cells','binary','utf8'])test(direction+' '+limit+' bound fails read-only',async t=>{
 const bad=limit==='lines'?'x\n'.repeat(4001):limit==='cells'?'a\n'.repeat(450):limit==='binary'?'bad\0text':Buffer.from([255]);
 const f=await fixture(t,direction==='stage'?{index:limit==='cells'?'b\n'.repeat(450):I,work:bad}:{index:limit==='cells'?'b\n'.repeat(450):I,head:bad}),before=await f.raw(),objects=await f.objects();
 await assert.rejects(prepare(f,direction));assert.deepEqual(await f.raw(),before);assert.deepEqual(await f.objects(),objects);
});
for(const direction of ['stage','unstage'])test(direction+' candidate growth exceeds byte bound read-only',async t=>{
 const index='i'.repeat(140000)+'\n',target='t'.repeat(140000)+'\n';
 const f=await fixture(t,direction==='stage'?{index,work:target}:{index,head:target}),p=await prepare(f,direction),before=await f.raw(),objects=await f.objects();
 await assert.rejects(select(f,direction,p,[p.plan.operations.find(o=>o.kind==='insert').id]),/Candidate exceeds 256 KiB/);
 assert.deepEqual(await f.raw(),before);assert.deepEqual(await f.objects(),objects);
});
for(const direction of ['stage','unstage'])test(direction+' supports non-MM and rejects cross-repository grant',async t=>{
 const f=await fixture(t,direction==='stage'?{index:H}:{work:I}),p=await prepare(f,direction),s=await select(f,direction,p),other=await fixture(t),before=await f.raw();
 await assert.rejects(apply(other,direction,s));assert.deepEqual(await f.raw(),before);
 await apply(f,direction,s);assert.deepEqual(await fs.readFile(path.join(f.root,'selected.txt')),Buffer.from(f.work));
});
test('reverse W is freshness-only, not a line-model input',async t=>{
 const work=Buffer.alloc(256*1024+1,0),f=await fixture(t,{work}),p=await prepare(f,'unstage');
 await apply(f,'unstage',await select(f,'unstage',p));assert.deepEqual(await fs.readFile(path.join(f.root,'selected.txt')),work);
});
