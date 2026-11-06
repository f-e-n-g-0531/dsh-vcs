import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import {git} from '../local-command.mjs';
import {listChanges} from '../vcs.mjs';
import {parseGitIndex} from '../src/git-index.mjs';
import {preparePartialIndexStage,selectPartialIndexStage,prepareIndexStage,prepareSelectedIndexStage,prepareIndexUnstage,prepareSelectedIndexUnstage,applyIndexStage,applyIndexUnstage,preparePartialIndexUnstage,selectPartialIndexUnstage,applyPartialIndexUnstage} from '../index-change.mjs';

const spawn=cp.spawn;
cp.spawn=(command,args,options)=>spawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-mm-absent-global')}});
syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
const H='old1\nanchor\nold2\n',I='staged1\nanchor\nstaged2\n',W='staged1\nanchor\nwork2\n';
const hooks={assertAuthorized(){},onStart(){}};
async function fixture(t,{head=H,index=I,work=W,format='sha1'}={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-partial-mm-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const run=(...a)=>git(root,a),write=(p,b)=>fs.writeFile(path.join(root,p),b),repo={type:'git',root};
 await run('init','--object-format='+format);
 for(const[k,v]of [['user.name','MM Test'],['user.email','mm@example.invalid'],['core.autocrlf','false'],['core.safecrlf','false'],['commit.gpgsign','false']])await run('config',k,v);
 await write('selected.txt',head);await write('staged.txt','staged base\n');await write('other.txt','other base\n');await run('add','.');await run('commit','-m','base');
 await write('selected.txt',index);await write('staged.txt','staged only\n');await write('other.txt','other staged\n');await run('add','.');
 await write('selected.txt',work);await write('other.txt','other MM\n');await write('untracked.txt','untracked\n');
 const raw=()=>fs.readFile(path.join(root,'.git','index'));
 const id=async(mode='staged')=>{const entry=(await listChanges(repo,mode)).find(e=>e.path==='selected.txt');assert.ok(entry);return entry.id;};
 const prepare=async()=>preparePartialIndexUnstage(repo,{id:await id()});
 const entries=async()=>parseGitIndex(await raw(),{objectFormat:format}).entries;
 return {root,repo,run,write,raw,id,prepare,entries,head,index,work};
}
const select=(f,p,ids=[p.plan.units[0].id])=>selectPartialIndexUnstage(f.repo,{snapshot:p,unitIds:ids});
const apply=(f,s,extra={})=>applyPartialIndexUnstage(f.repo,{snapshot:s,...hooks,...extra});
async function untouched(f,entries,head){
 assert.deepEqual((await f.entries()).filter(e=>e.path!=='selected.txt'),entries.filter(e=>e.path!=='selected.txt'));
 assert.deepEqual(await f.run('rev-parse','HEAD'),head);
 for(const[p,b]of [['selected.txt',f.work],['other.txt','other MM\n'],['staged.txt','staged only\n'],['untracked.txt','untracked\n']])assert.deepEqual(await fs.readFile(path.join(f.root,p)),Buffer.from(b));
}

for(const format of ['sha1','sha256'])for(const work of [W,I])test('reverse current Index to pinned HEAD '+format+' '+(work===I?'M-space':'MM'),async t=>{
 const f=await fixture(t,{format,work}),entries=await f.entries(),head=await f.run('rev-parse','HEAD'),p=await f.prepare();
 assert.equal(p.plan.units.length,2);assert.deepEqual(p.plan.units[0].before.map(l=>l.text),['staged1']);assert.deepEqual(p.plan.units[0].after.map(l=>l.text),['old1']);
 await apply(f,await select(f,p));assert.deepEqual(await f.run('show',':selected.txt'),Buffer.from('old1\nanchor\nstaged2\n'));await untouched(f,entries,head);
 const remaining=await f.prepare();assert.equal(remaining.plan.units.length,1);await apply(f,await select(f,remaining));assert.deepEqual(await f.run('show',':selected.txt'),Buffer.from(H));await untouched(f,entries,head);
});
for(const format of ['sha1','sha256'])test('all reverse units yields exact HEAD '+format,async t=>{
 const f=await fixture(t,{format}),p=await f.prepare();await apply(f,await select(f,p,p.plan.units.map(u=>u.id)));assert.deepEqual(await f.run('show',':selected.txt'),Buffer.from(H));assert.deepEqual(await fs.readFile(path.join(f.root,'selected.txt')),Buffer.from(W));
});
test('raw BOM mixed EOL and missing final newline are preserved',async t=>{
 const head='﻿old1\r\nanchor\nold2',index='﻿staged1\r\nanchor\nstaged2',work='﻿staged1\r\nanchor\nwork2';
 const f=await fixture(t,{head,index,work}),p=await f.prepare();await apply(f,await select(f,p));assert.deepEqual(await f.run('show',':selected.txt'),Buffer.from('﻿old1\r\nanchor\nstaged2'));assert.deepEqual(await fs.readFile(path.join(f.root,'selected.txt')),Buffer.from(work));
});
for(const phase of ['select','apply'])for(const mutation of ['index','work','head','unrelated work'])test(phase+' rejects stale '+mutation,async t=>{
 const f=await fixture(t),p=await f.prepare(),s=phase==='apply'?await select(f,p):null;
 if(mutation==='index')await f.run('add','untracked.txt');if(mutation==='work')await f.write('selected.txt',W+'foreign');if(mutation==='head')await f.run('commit','--allow-empty','-m','advance');if(mutation==='unrelated work')await f.write('other.txt','foreign');
 const before=await f.raw();let starts=0;await assert.rejects(phase==='select'?select(f,p):apply(f,s,{onStart(){starts++;}}));assert.equal(starts,0);assert.deepEqual(await f.raw(),before);
});
test('clones, cross-direction plans and grants cannot authorize publication',async t=>{
 const f=await fixture(t),p=await f.prepare(),before=await f.raw(),forward=await preparePartialIndexStage(f.repo,{id:await f.id('unstaged')});
 for(const snapshot of [{...p},JSON.parse(JSON.stringify(p)),forward])await assert.rejects(select(f,snapshot,[p.plan.units[0].id]));
 await assert.rejects(selectPartialIndexStage(f.repo,{snapshot:p,unitIds:[p.plan.units[0].id]}));
 const s=await select(f,p);for(const publish of [applyIndexStage,applyIndexUnstage])await assert.rejects(publish(f.repo,{snapshot:s,...hooks}));await assert.rejects(apply(f,{...s}));await assert.rejects(apply(f,p));
 const stage=await selectPartialIndexStage(f.repo,{snapshot:forward,unitIds:[forward.plan.units[0].id]});await assert.rejects(apply(f,stage));
 const other=await fixture(t);await assert.rejects(apply(other,s));assert.deepEqual(await f.raw(),before);
 for(const prepare of [prepareIndexUnstage,prepareIndexStage])await assert.rejects(prepare(f.repo,{path:'selected.txt',partialMM:true}));
});
test('exact staged IDs reject forward IDs and wrong staged work-status IDs',async t=>{
 const f=await fixture(t);await assert.rejects(preparePartialIndexUnstage(f.repo,{id:await f.id('unstaged')}));
 const wrong=createHash('sha256').update(JSON.stringify(['staged','selected.txt',undefined,'modified','M',' ',undefined,undefined,undefined])).digest('hex');await assert.rejects(preparePartialIndexUnstage(f.repo,{id:wrong}));
});
test('selection is single-use, validates IDs and copies before await',async t=>{
 const f=await fixture(t);
 for(const kind of ['empty','duplicate','unknown']){const p=await f.prepare(),ids=kind==='empty'?[]:kind==='duplicate'?[p.plan.units[0].id,p.plan.units[0].id]:['unknown'];await assert.rejects(select(f,p,ids));await assert.rejects(select(f,p));}
 const p=await f.prepare(),ids=[p.plan.units[0].id],promise=select(f,p,ids);ids[0]=p.plan.units[1].id;await apply(f,await promise);assert.deepEqual(await f.run('show',':selected.txt'),Buffer.from('old1\nanchor\nstaged2\n'));
});
for(const source of ['head','index'])test('bounds independent fixed '+source+' blob read',async t=>{
 const big='x'.repeat(256*1024+1),f=await fixture(t,source==='head'?{head:big}:{index:big});await assert.rejects(f.prepare());
});
test('selected mode changes are not accepted as modified text',async t=>{
 const f=await fixture(t);await f.run('update-index','--chmod=+x','selected.txt');await assert.rejects(f.prepare());
});
test('pre-start abort and authorization refusal leave raw Index unchanged',async t=>{
 const f=await fixture(t),p=await f.prepare(),s=await select(f,p),before=await f.raw(),controller=new AbortController();controller.abort();let starts=0;
 await assert.rejects(apply(f,s,{signal:controller.signal,onStart(){starts++;}}));await assert.rejects(apply(f,s,{assertAuthorized(){throw Error('denied');},onStart(){starts++;}}));assert.equal(starts,0);assert.deepEqual(await f.raw(),before);
});
test('full work is freshness-only and is not constrained to partial model bytes',async t=>{
 const work='w'.repeat(256*1024+1),f=await fixture(t,{work}),p=await f.prepare();await apply(f,await select(f,p));assert.deepEqual(await f.run('show',':selected.txt'),Buffer.from('old1\nanchor\nstaged2\n'));assert.equal((await fs.stat(path.join(f.root,'selected.txt'))).size,work.length);
});
test('clean Index has no partial unstage and caller cannot opt whole-file MM in',async t=>{
 const clean=await fixture(t,{index:H}),fake=createHash('sha256').update(JSON.stringify(['staged','selected.txt',undefined,'modified','M','M',undefined,undefined,undefined])).digest('hex');await assert.rejects(preparePartialIndexUnstage(clean.repo,{id:fake}));
 const f=await fixture(t);await assert.rejects(prepareSelectedIndexUnstage(f.repo,{id:await f.id(),partialMM:true}));await assert.rejects(prepareSelectedIndexStage(f.repo,{id:await f.id('unstaged'),partialMM:true}));
});
test('foreign metadata mutation after append is unknown and cannot be rebaselined',async t=>{
 const f=await fixture(t),p=await f.prepare(),s=await select(f,p),before=await f.raw();let started=false;
 await assert.rejects(apply(f,s,{onStart(){started=true;},async assertAuthorized(){if(started)await f.write('.git/foreign-note','foreign');}}),e=>e.code==='vcs/index-outcome-unknown');assert.deepEqual(await f.raw(),before);assert.deepEqual(await f.run('cat-file','blob',s.target.oid),Buffer.from('old1\nanchor\nstaged2\n'));
});
test('cancellation after append is unknown and retains exact candidate blob',async t=>{
 const f=await fixture(t),p=await f.prepare(),s=await select(f,p),before=await f.raw(),controller=new AbortController();let started=false;
 await assert.rejects(apply(f,s,{signal:controller.signal,onStart(){started=true;},async assertAuthorized(){if(started){try{await fs.access(path.join(f.root,'.git','objects',s.target.oid.slice(0,2),s.target.oid.slice(2)));}catch(e){if(e.code==='ENOENT')return;throw e;}controller.abort();}}}),e=>e.code==='vcs/index-outcome-unknown');assert.deepEqual(await f.raw(),before);assert.deepEqual(await f.run('cat-file','blob',s.target.oid),Buffer.from('old1\nanchor\nstaged2\n'));
});
test('unknown after blob append retains candidate object and does not roll back or publish Index',async t=>{
 const f=await fixture(t),p=await f.prepare(),s=await select(f,p),before=await f.raw();let started=false;
 await assert.rejects(apply(f,s,{onStart(){started=true;},async assertAuthorized(){if(started){try{await fs.access(path.join(f.root,'.git','objects',s.target.oid.slice(0,2),s.target.oid.slice(2)));}catch(e){if(e.code==='ENOENT')return;throw e;}throw Error('authorization revoked');}}}),e=>e.code==='vcs/index-outcome-unknown'&&e.appendOnly===true);
 assert.equal(started,true);assert.deepEqual(await f.raw(),before);assert.deepEqual(await f.run('cat-file','blob',s.target.oid),Buffer.from('old1\nanchor\nstaged2\n'));await assert.rejects(fs.stat(path.join(f.root,'.git','index.lock')),{code:'ENOENT'});
});
