import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {writeFileSync,existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {syncBuiltinESMExports} from 'node:module';
import {git} from '../local-command.mjs';
import {parseGitIndex} from '../src/git-index.mjs';
import {preparePartialIndexStage,selectPartialIndexStage,prepareIndexStage,applyIndexStage,applyIndexUnstage} from '../index-change.mjs';
const originalSpawn=cp.spawn;
cp.spawn=(command,args,options)=>originalSpawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-partial-absent-global-config')}});
syncBuiltinESMExports();
test.after(()=>{cp.spawn=originalSpawn;syncBuiltinESMExports();});
const base=Buffer.from('first\nold A\nmiddle\nold B\nlast\n'),work=Buffer.from('first\nnew A\nmiddle\nnew B\nlast\n');
const id=createHash('sha256').update(JSON.stringify(['unstaged','selected.txt',undefined,'modified',' ','M',undefined,undefined,undefined])).digest('hex');
const hooks={assertAuthorized:()=>{},onStart:()=>{}};
const blobOid=(bytes,format)=>createHash(format).update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
async function fixture(t,format='sha1',before=base,after=work){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-partial-stage-')));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const run=(...args)=>git(root,args),write=(p,b)=>fs.writeFile(path.join(root,p),b);
 await run('init','--object-format='+format);
 for(const [key,value]of [['user.name','Partial Test'],['user.email','test@example.invalid'],['core.autocrlf','false'],['core.safecrlf','false'],['commit.gpgsign','false']])await run('config',key,value);
 await write('selected.txt',before);await write('other.txt','other base\n');await run('add','.');await run('commit','-m','base');
 await write('selected.txt',after);await write('other.txt','other staged\n');await run('add','other.txt');await write('other.txt','other MM\n');await write('untracked.txt','untracked');
 const repo={type:'git',root},index=()=>fs.readFile(path.join(root,'.git','index'));
 return {root,run,write,repo,index,format,before,after,prepare:()=>preparePartialIndexStage(repo,{id})};
}
const select=(f,snapshot,unitIds=[snapshot.plan.units[0].id])=>selectPartialIndexStage(f.repo,{snapshot,unitIds});
const apply=(f,snapshot,extra={})=>applyIndexStage(f.repo,{snapshot,...hooks,...extra});
const objectPath=(f,s)=>path.join(f.root,'.git','objects',s.target.oid.slice(0,2),s.target.oid.slice(2));
for(const format of ['sha1','sha256'])for(const all of [false,true])test('real '+format+' '+(all?'all units equals full stage':'one of two disjoint edits'),async t=>{
 const f=await fixture(t,format),before=await f.index(),entries=parseGitIndex(before,{objectFormat:format}).entries,head=await f.run('rev-parse','HEAD');
 const p=await f.prepare();assert.equal(p.plan.units.length,2);assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.index)&&Object.isFrozen(p.plan.units[0].after[0]));
 assert.equal(Object.hasOwn(p,'bytes'),false);assert.equal(Object.hasOwn(p,'state'),false);
 assert.throws(()=>{p.plan.units[0].after[0].text='evil';},TypeError);
 const ids=(all?p.plan.units:[p.plan.units[0]]).map(u=>u.id),pending=select(f,p,ids);ids.splice(0,ids.length,'evil');const s=await pending;
 const expected=all?work:Buffer.from('first\nnew A\nmiddle\nold B\nlast\n');
 assert.ok(Object.isFrozen(s)&&Object.isFrozen(s.target)&&Object.isFrozen(s.unitIds));assert.equal(s.planId,p.plan.id);assert.equal(s.target.oid,blobOid(expected,format));assert.equal(s.target.mode,p.index.mode);
 assert.deepEqual(await f.index(),before);await assert.rejects(select(f,p),{code:'vcs/index-stale'});
 await apply(f,s);assert.deepEqual(await f.run('cat-file','blob',s.target.oid),expected);assert.deepEqual(await fs.readFile(path.join(f.root,'selected.txt')),work);
 const after=parseGitIndex(await f.index(),{objectFormat:format}).entries;assert.deepEqual(after.filter(e=>e.path!=='selected.txt'),entries.filter(e=>e.path!=='selected.txt'));assert.equal(after.find(e=>e.path==='selected.txt').oid,s.target.oid);
 assert.deepEqual(await f.run('rev-parse','HEAD'),head);assert.equal(await fs.readFile(path.join(f.root,'other.txt'),'utf8'),'other MM\n');await assert.rejects(apply(f,s));
});
for(const [label,before,after,expected]of [
 ['mixed EOL BOM no final','﻿a\r\nold\rmid\nlast','﻿a\r\nnew\rmid\nLAST','﻿a\r\nnew\rmid\nlast'],
 ['final newline edit','a\nold\nmiddle\nlast\n','a\nnew\nmiddle\nlast','a\nnew\nmiddle\nlast\n'],
 ['BOM edit','a\nmid\nold','﻿a\nmid\nnew','﻿a\nmid\nold']
])test('raw fidelity '+label,async t=>{const f=await fixture(t,'sha1',Buffer.from(before),Buffer.from(after)),p=await f.prepare(),s=await select(f,p);await apply(f,s);assert.deepEqual(await f.run('cat-file','blob',s.target.oid),Buffer.from(expected));assert.deepEqual(await fs.readFile(path.join(f.root,'selected.txt')),Buffer.from(after));});
test('clones tampered plans and snapshot API cross-use refuse',async t=>{
 const f=await fixture(t),p=await f.prepare(),full=await prepareIndexStage(f.repo,{path:'selected.txt'});
 for(const s of [{...p},JSON.parse(JSON.stringify(p)),{...p,plan:{...p.plan,id:'evil'}},full])await assert.rejects(selectPartialIndexStage(f.repo,{snapshot:s,unitIds:[p.plan.units[0].id]}),{code:'vcs/index-stale'});
 await assert.rejects(apply(f,p),{code:'vcs/index-stale'});const s=await select(f,p);
 await assert.rejects(selectPartialIndexStage(f.repo,{snapshot:s,unitIds:s.unitIds}),{code:'vcs/index-stale'});
 await assert.rejects(apply(f,{...s}),{code:'vcs/index-stale'});await assert.rejects(applyIndexUnstage(f.repo,{snapshot:s,...hooks}),{code:'vcs/index-stale'});
 const other=await fixture(t);await assert.rejects(apply(other,s));
});
for(const bad of [[],['unknown'],null,'string',['duplicate','duplicate']])test('invalid selection '+JSON.stringify(bad)+' consumes plan',async t=>{
 const f=await fixture(t),p=await f.prepare(),ids=bad?.[0]==='duplicate'?[p.plan.units[0].id,p.plan.units[0].id]:bad,before=await f.index();
 await assert.rejects(select(f,p,ids));await assert.rejects(select(f,p),{code:'vcs/index-stale'});assert.deepEqual(await f.index(),before);
});
for(const phase of ['select','apply'])for(const mutation of ['work','unrelated','index','head','config'])test(phase+' stale '+mutation+' refuses',async t=>{
 const f=await fixture(t),p=await f.prepare(),s=phase==='apply'?await select(f,p):null;
 if(mutation==='work')await f.write('selected.txt','changed');if(mutation==='unrelated')await f.write('untracked.txt','changed');if(mutation==='index')await f.run('add','untracked.txt');if(mutation==='head')await f.run('commit','--allow-empty','-m','advance');if(mutation==='config')await f.run('config','test.changed','yes');
 const before=await f.index();let starts=0;await assert.rejects(phase==='select'?select(f,p):apply(f,s,{onStart:()=>starts++}));assert.equal(starts,0);assert.deepEqual(await f.index(),before);
});
for(const [label,before,after]of [
 ['Index byte overflow',Buffer.alloc(256*1024+1,97),Buffer.from('different')],
 ['work byte overflow',Buffer.from('base'),Buffer.alloc(256*1024+1,98)],
 ['Index far over bound',Buffer.alloc(300*1024,97),Buffer.from('different')],
 ['line overflow',Buffer.from('a\n'.repeat(4001)),Buffer.from('changed')],
 ['exact LCS refusal',Buffer.from('a\n'.repeat(450)),Buffer.from('b\n'.repeat(450))],
 ['invalid UTF8',base,Buffer.from([255])],['binary NUL',base,Buffer.from([0])]
])test('bounds refuse without mutation '+label,async t=>{const f=await fixture(t,'sha1',before,after),index=await f.index();await assert.rejects(f.prepare());assert.deepEqual(await f.index(),index);});
test('exact 256KiB and 4000 line boundaries are accepted',async t=>{
 for(const [before,after]of [[Buffer.alloc(256*1024,97),Buffer.alloc(256*1024,98)],[Buffer.from('same\n'.repeat(3999)+'old\n'),Buffer.from('same\n'.repeat(3999)+'new\n')]]){const f=await fixture(t,'sha1',before,after),p=await f.prepare(),s=await select(f,p,p.plan.units.map(u=>u.id));assert.equal(s.target.oid,blobOid(after,'sha1'));}
});
for(const mutation of ['MM','same work','attributes','autocrlf','flags','mode'])test('unchanged first boundary guards '+mutation,async t=>{
 const f=await fixture(t);if(mutation==='MM'){await f.run('add','selected.txt');await f.write('selected.txt','further changes');}if(mutation==='same work')await f.write('selected.txt',base);if(mutation==='attributes')await f.write('.gitattributes','* text');if(mutation==='autocrlf')await f.run('config','core.autocrlf','true');if(mutation==='flags')await f.run('update-index','--skip-worktree','selected.txt');if(mutation==='mode')await f.run('update-index','--chmod=+x','selected.txt');
 const before=await f.index();await assert.rejects(f.prepare());assert.deepEqual(await f.index(),before);
});
test('missing or path-like id refused',async t=>{const f=await fixture(t);for(const bad of [undefined,'selected.txt','f'.repeat(64)])await assert.rejects(preparePartialIndexStage(f.repo,{id:bad}));});
test('partial candidate append remains on failed full-work CAS, unknown not rollback',async t=>{
 const f=await fixture(t),p=await f.prepare(),s=await select(f,p),before=await f.index();let started=false,changed=false;
 await assert.rejects(apply(f,s,{onStart:()=>{started=true;},assertAuthorized:()=>{if(started&&!changed&&existsSync(objectPath(f,s))){changed=true;writeFileSync(path.join(f.root,'untracked.txt'),'foreign edit');}}}),e=>e.code==='vcs/index-outcome-unknown'&&e.outcomeUnknown&&e.appendOnly);
 assert.ok(started&&changed);assert.deepEqual(await f.index(),before);assert.deepEqual(await f.run('cat-file','blob',s.target.oid),Buffer.from('first\nnew A\nmiddle\nold B\nlast\n'));assert.deepEqual(await fs.readFile(path.join(f.root,'selected.txt')),work);
});
test('fixed Index blob bytes require exact object hash',async t=>{
 const f=await fixture(t),oid=(await f.run('rev-parse','HEAD:selected.txt')).toString().trim(),file=path.join(f.root,'.git','objects',oid.slice(0,2),oid.slice(2));
 const wrong=Buffer.from('wrong blob'),header=Buffer.from('blob '+wrong.length+String.fromCharCode(0));await fs.chmod(file,0o600);await fs.writeFile(file,deflateSync(Buffer.concat([header,wrong])));
 const before=await f.index();await assert.rejects(f.prepare(),{code:'vcs/index-stale'});assert.deepEqual(await f.index(),before);
});
test('prepare second capture detects mutation during fixed blob read',async t=>{
 const f=await fixture(t),savedSpawn=cp.spawn;let changed=false;
 cp.spawn=(command,args,options)=>{const child=savedSpawn(command,args,options);if(args.includes('cat-file')&&args.includes('blob'))child.once('close',()=>{changed=true;writeFileSync(path.join(f.root,'untracked.txt'),'changed during read');});return child;};syncBuiltinESMExports();
 try{await assert.rejects(f.prepare(),{code:'vcs/index-stale'});assert.ok(changed);}finally{cp.spawn=savedSpawn;syncBuiltinESMExports();}
});
test('cancellation consumes select grant and refuses before writes',async t=>{const f=await fixture(t),p=await f.prepare(),c=new AbortController();c.abort();await assert.rejects(selectPartialIndexStage(f.repo,{snapshot:p,unitIds:[p.plan.units[0].id],signal:c.signal}));await assert.rejects(select(f,p),{code:'vcs/index-stale'});});
