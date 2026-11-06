import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createHash} from 'node:crypto';
import {git} from '../local-command.mjs';
import {listChanges} from '../vcs.mjs';
import {parseGitIndex} from '../src/git-index.mjs';
import {preparePartialIndexStage,selectPartialIndexStage,prepareIndexStage,prepareSelectedIndexStage,prepareIndexUnstage,prepareSelectedIndexUnstage,applyIndexStage,applyIndexUnstage} from '../index-change.mjs';

const spawn=cp.spawn;
cp.spawn=(command,args,options)=>spawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-mm-absent-global')}});
syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});
const H='old1\nanchor\nold2\n',W='new1\nanchor\nnew2\n',I='new1\nanchor\nold2\n';
const hooks={assertAuthorized(){},onStart(){}};
const oid=bytes=>createHash('sha1').update(Buffer.from('blob '+Buffer.byteLength(bytes)+'\0')).update(bytes).digest('hex');
async function fixture(t,{head=H,index=head,work=W}={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-partial-mm-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const run=(...a)=>git(root,a),write=(p,b)=>fs.writeFile(path.join(root,p),b),repo={type:'git',root};
 await run('init');
 for(const[k,v]of [['user.name','MM Test'],['user.email','mm@example.invalid'],['core.autocrlf','false'],['core.safecrlf','false'],['commit.gpgsign','false']])await run('config',k,v);
 await write('selected.txt',head);await write('staged.txt','staged base\n');await write('other.txt','other base\n');await run('add','.');await run('commit','-m','base');
 await write('selected.txt',index);await write('staged.txt','staged only\n');await write('other.txt','other staged\n');await run('add','.');
 await write('selected.txt',work);await write('other.txt','other MM\n');await write('untracked.txt','untracked\n');
 const raw=()=>fs.readFile(path.join(root,'.git','index'));
 const id=async(mode='unstaged')=>{const entry=(await listChanges(repo,mode)).find(e=>e.path==='selected.txt');assert.ok(entry);return entry.id;};
 const prepare=async()=>preparePartialIndexStage(repo,{id:await id()});
 const entries=async()=>parseGitIndex(await raw()).entries;
 return {root,repo,run,write,raw,id,prepare,entries,head,index,work};
}
const select=(f,p,ids=[p.plan.units[0].id])=>selectPartialIndexStage(f.repo,{snapshot:p,unitIds:ids});
const apply=(f,s,extra={})=>applyIndexStage(f.repo,{snapshot:s,...hooks,...extra});
async function untouched(f,entries,head){
 assert.deepEqual((await f.entries()).filter(e=>e.path!=='selected.txt'),entries.filter(e=>e.path!=='selected.txt'));
 assert.deepEqual(await f.run('rev-parse','HEAD'),head);
 for(const[p,b]of [['selected.txt',f.work],['other.txt','other MM\n'],['staged.txt','staged only\n'],['untracked.txt','untracked\n']])assert.deepEqual(await fs.readFile(path.join(f.root,p)),Buffer.from(b));
}

test('two successive real selections: first creates MM, next stages only remaining Index-to-work edit',async t=>{
 const f=await fixture(t),entries=await f.entries(),head=await f.run('rev-parse','HEAD');
 const first=await f.prepare();assert.equal(first.plan.units.length,2);
 await apply(f,await select(f,first));
 assert.deepEqual(await f.run('show',':selected.txt'),Buffer.from(I));
 assert.match((await f.run('status','--porcelain')).toString(),/MM selected.txt/);
 await untouched(f,entries,head);
 const second=await f.prepare();assert.equal(second.index.oid,oid(I));assert.equal(second.plan.units.length,1);
 assert.deepEqual(second.plan.units[0].before.map(l=>l.text),['old2']);
 assert.deepEqual(second.plan.units[0].after.map(l=>l.text),['new2']);
 await apply(f,await select(f,second));assert.deepEqual(await f.run('show',':selected.txt'),Buffer.from(W));
 assert.match((await f.run('status','--porcelain')).toString(),/M  selected.txt/);
 await untouched(f,entries,head);
});

for(const[label,head,index,work,expected]of [
 ['three-state','HEAD1\nanchor\nHEAD2\n','INDEX1\nanchor\nINDEX2\n','WORK1\nanchor\nWORK2\n','WORK1\nanchor\nINDEX2\n'],
 ['BOM mixed EOL no final','﻿HEAD1\r\nanchor\nHEAD2','﻿INDEX1\r\nanchor\nINDEX2','﻿WORK1\r\nanchor\nWORK2','﻿WORK1\r\nanchor\nINDEX2'],
 ['BOM insertion after staged edit','HEAD\nanchor\nold','INDEX\nanchor\nold','﻿INDEX\nanchor\nnew','﻿INDEX\nanchor\nold'],
])test('preexisting H != I != W uses actual Index raw base: '+label,async t=>{
 const f=await fixture(t,{head,index,work}),entries=await f.entries(),p=await f.prepare(),headId=await f.run('rev-parse','HEAD');
 assert.equal(p.index.oid,oid(index));assert.equal(p.plan.units.length,2);
 await apply(f,await select(f,p));assert.deepEqual(await f.run('show',':selected.txt'),Buffer.from(expected));await untouched(f,entries,headId);
 const remaining=await f.prepare();assert.equal(remaining.plan.units.length,1);await apply(f,await select(f,remaining));
 assert.deepEqual(await f.run('show',':selected.txt'),Buffer.from(work));await untouched(f,entries,headId);
});

for(const phase of ['select','apply'])for(const mutation of ['index','work','head','unrelated work'])test('MM '+phase+' rejects stale '+mutation+' before start',async t=>{
 const f=await fixture(t,{index:I}),p=await f.prepare(),s=phase==='apply'?await select(f,p):null;
 if(mutation==='index')await f.run('add','staged.txt','untracked.txt');
 if(mutation==='work')await f.write('selected.txt',W+'foreign');
 if(mutation==='head')await f.run('commit','--allow-empty','-m','advance');
 if(mutation==='unrelated work')await f.write('other.txt','foreign');
 const before=await f.raw();let starts=0;
 await assert.rejects(phase==='select'?select(f,p):apply(f,s,{onStart(){starts++;}}));
 assert.equal(starts,0);assert.deepEqual(await f.raw(),before);
});

test('MM policy remains private: clones, cross-whole, cross-repository and public opt-ins refuse',async t=>{
 const f=await fixture(t,{index:I}),p=await f.prepare(),before=await f.raw();
 assert.equal(Object.hasOwn(p,'partialMM'),false);
 const ordinary=await fixture(t),full=await prepareIndexStage(ordinary.repo,{path:'selected.txt',partialMM:true});
 for(const snapshot of [{...p},JSON.parse(JSON.stringify(p)),{...p,partialMM:true},full])await assert.rejects(select(f,snapshot,[p.plan.units[0].id]),{code:'vcs/index-stale'});
 await assert.rejects(apply(f,p),{code:'vcs/index-stale'});
 const s=await select(f,p);assert.equal(Object.hasOwn(s,'partialMM'),false);
 await assert.rejects(apply(f,{...s,partialMM:true}),{code:'vcs/index-stale'});
 await assert.rejects(applyIndexUnstage(f.repo,{snapshot:s,...hooks,partialMM:true}),{code:'vcs/index-stale'});
 await assert.rejects(select(f,s,s.unitIds),{code:'vcs/index-stale'});
 await assert.rejects(apply(ordinary,s));
 for(const prepare of [prepareIndexStage,prepareIndexUnstage])await assert.rejects(prepare(f.repo,{path:'selected.txt',partialMM:true}));
 await assert.rejects(prepareSelectedIndexStage(f.repo,{id:await f.id(),partialMM:true}));
 await assert.rejects(prepareSelectedIndexUnstage(f.repo,{id:await f.id('staged'),partialMM:true}));
 assert.deepEqual(await f.raw(),before);
});

test('MM exact unstaged ID rejects space/M and staged IDs despite path match',async t=>{
 const f=await fixture(t,{index:I}),before=await f.raw();
 const forged=createHash('sha256').update(JSON.stringify(['unstaged','selected.txt',undefined,'modified',' ','M',undefined,undefined,undefined])).digest('hex');
 for(const id of [forged,await f.id('staged')])await assert.rejects(preparePartialIndexStage(f.repo,{id}));
 assert.deepEqual(await f.raw(),before);
});

test('MM mode change remains unsupported',async t=>{
 const f=await fixture(t,{index:I});await f.run('update-index','--chmod=+x','selected.txt');const before=await f.raw();
 await assert.rejects(f.prepare());assert.deepEqual(await f.raw(),before);
});

test('MM publication still pins full work after append; failures remain outcome unknown',async t=>{
 const f=await fixture(t,{index:'index1\nanchor\nindex2\n'}),p=await f.prepare(),s=await select(f,p),before=await f.raw();
 let starts=0;
 await assert.rejects(apply(f,s,{onStart(){starts++;writeFileSync(path.join(f.root,'other.txt'),'foreign edit');}}),e=>e.code==='vcs/index-outcome-unknown'&&e.outcomeUnknown&&e.appendOnly);
 assert.equal(starts,1);assert.deepEqual(await f.raw(),before);assert.deepEqual(await fs.readFile(path.join(f.root,'selected.txt')),Buffer.from(W));
});
