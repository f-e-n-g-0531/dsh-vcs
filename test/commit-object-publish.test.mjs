import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {publishCommitObjects} from '../commit-object-publish.mjs';
import {buildIndexTree} from '../src/index-tree.mjs';
import {encodeGitTree,encodeGitCommit} from '../src/git-commit-object.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';

const identity={name:'A',email:'a@example.com',timestamp:1,timezone:'+0000'};
const hash=(type,body,format='sha1')=>createHash(format).update(type+' '+body.length+'\0').update(body).digest('hex');
function plan(format='sha1'){
 const oid='1'.repeat(format==='sha1'?40:64);
 const graph=buildIndexTree([{path:'a/file',mode:'100644',oid},{path:'b/deep/run',mode:'100755',oid},{path:'top',mode:'100644',oid}],{objectFormat:format});
 const commit=encodeGitCommit({tree:graph.root,author:identity,committer:identity,message:'payload'},{objectFormat:format});
 return {trees:graph.trees,commit,objectFormat:format};
}
async function fixture(t,format='sha1'){
 const dir=await mkdtemp(path.join(tmpdir(),'dsh-publish-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const root=await realpath(dir),gitDirectory=path.join(root,'.git');
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'no-global')};
 execFileSync('git',['init','-q','--object-format='+format,root],{env,stdio:'pipe'});
 const git=(...args)=>execFileSync('git',['-C',root,...args],{env,stdio:'pipe'});
 const target=oid=>path.join(gitDirectory,'objects',oid.slice(0,2),oid.slice(2));
 return {root,gitDirectory,git,target,options:{...plan(format),gitDirectory,assertAuthorized(){},onStart(){}}};
}
const unknown=e=>e.code==='vcs/commit-objects-outcome-unknown'&&e.appendOnly===true&&e.outcomeUnknown===true;
for(const format of ['sha1','sha256'])test('real '+format+' child-first graph, cat-file, repeat and HEAD/index untouched',async t=>{
 const f=await fixture(t,format),head=await readFile(path.join(f.gitDirectory,'HEAD'));
 const index=Buffer.from('opaque index sentinel');await writeFile(path.join(f.gitDirectory,'index'),index);
 let starts=0;const result=await publishCommitObjects({...f.options,onStart(){starts++;}});
 assert.equal(starts,1);assert.equal(result.tree,f.options.trees.at(-1).oid);assert.equal(result.commit,f.options.commit.oid);
 assert.deepEqual(result.created,[...f.options.trees.map(t=>({type:'tree',oid:t.oid})),{type:'commit',oid:f.options.commit.oid}]);
 for(const tree of f.options.trees)assert.deepEqual(f.git('cat-file','tree',tree.oid),tree.body);
 assert.deepEqual(f.git('cat-file','commit',result.commit),f.options.commit.body);
 const before=await Promise.all(result.created.map(o=>readFile(f.target(o.oid))));
 assert.deepEqual(await publishCommitObjects({...f.options,onStart(){assert.fail('all-existing read-only');}}),{tree:result.tree,commit:result.commit,created:[]});
 assert.deepEqual(await Promise.all(result.created.map(o=>readFile(f.target(o.oid)))),before);
 assert.deepEqual(await readFile(path.join(f.gitDirectory,'HEAD')),head);assert.deepEqual(await readFile(path.join(f.gitDirectory,'index')),index);
});
for(const callback of ['assertAuthorized','onStart'])test('captures ALL buffers and own-data before '+callback,async t=>{
 const f=await fixture(t),expected=structuredClone(f.options.trees.map(t=>({path:t.path,oid:t.oid,body:t.body})));
 const expectedCommit=Buffer.from(f.options.commit.body),commitOid=f.options.commit.oid;let changed=false;
 f.options[callback]=()=>{if(changed)return;changed=true;for(const tree of f.options.trees){tree.body.fill(0);tree.oid='f'.repeat(40);tree.path='wrong';}f.options.commit.body.fill(0);f.options.commit.oid='e'.repeat(40);f.options.trees.length=0;f.options.objectFormat='sha256';f.options.gitDirectory='bad';};
 const result=await publishCommitObjects(f.options);assert.equal(result.commit,commitOid);
 for(const tree of expected)assert.deepEqual(f.git('cat-file','tree',tree.oid),Buffer.from(tree.body));
 assert.deepEqual(f.git('cat-file','commit',result.commit),expectedCommit);
});
test('captures synchronously before return to caller',async t=>{
 const f=await fixture(t),oid=f.options.commit.oid,body=Buffer.from(f.options.commit.body);
 const pending=publishCommitObjects(f.options);for(const tree of f.options.trees)tree.body.fill(8);f.options.commit.body.fill(9);
 assert.equal((await pending).commit,oid);assert.deepEqual(f.git('cat-file','commit',oid),body);
});

const badCases={
 'empty list':p=>{p.trees=[];},
 'tree hash tamper':p=>{p.trees[0].body[0]^=1;},
 'commit hash tamper':p=>{p.commit.body[0]^=1;},
 'abbreviated OID':p=>{p.trees[0].oid=p.trees[0].oid.slice(1);},
 'uppercase OID':p=>{p.commit.oid=p.commit.oid.toUpperCase();},
 'root not last':p=>p.trees.reverse(),
 'duplicate root':p=>p.trees.push({...p.trees.at(-1)}),
 'wrong child path':p=>{p.trees[0].path='elsewhere';},
 'dependency order':p=>{[p.trees[1],p.trees[2]]=[p.trees[2],p.trees[1]];},
 'independent sibling order':p=>{[p.trees[0],p.trees[1],p.trees[2]]=[p.trees[1],p.trees[2],p.trees[0]];},
 'unused tree':p=>{p.trees.unshift({path:'unused',...encodeGitTree([])});},
 'root mismatch':p=>{p.commit=encodeGitCommit({tree:'2'.repeat(40),author:identity,committer:identity,message:''});},
 'malformed authenticated commit':p=>{p.commit.body=Buffer.from('tree '+p.trees.at(-1).oid+'\n\n');p.commit.oid=hash('commit',p.commit.body);},
 'tree count cap':p=>{p.trees=Array(100002);},
 'aggregate cap':p=>{p.trees=[{path:'a',oid:'1'.repeat(40),body:Buffer.alloc(4*1024*1024+1)},{path:'',oid:'1'.repeat(40),body:Buffer.alloc(4*1024*1024)}];},
 'commit cap':p=>{p.commit.body=Buffer.alloc(128*1024+1);},
};
for(const [label,mutate] of Object.entries(badCases))test('reject pre-I/O '+label,async()=>{
 const p=plan();mutate(p);let callbacks=0;
 await assert.rejects(publishCommitObjects({...p,gitDirectory:path.resolve('nonexistent','.git'),assertAuthorized(){callbacks++;},onStart(){callbacks++;}}));assert.equal(callbacks,0);
});
for(const [label,body] of [
 ['alias mode',Buffer.concat([Buffer.from('040000 dir\0'),Buffer.alloc(20,1)])],
 ['unsupported mode',Buffer.concat([Buffer.from('120000 file\0'),Buffer.alloc(20,1)])],
 ['truncated',Buffer.from('100644 file\0x')],
 ['unsafe path',Buffer.concat([Buffer.from('100644 ..\0'),Buffer.alloc(20,1)])],
 ['unsafe backslash',Buffer.concat([Buffer.from('100644 a\\b\0'),Buffer.alloc(20,1)])],
 ['invalid UTF8',Buffer.concat([Buffer.from('100644 '),Buffer.from([255,0]),Buffer.alloc(20,1)])],
 ['noncanonical ordering',Buffer.concat([Buffer.from('100644 z\0'),Buffer.alloc(20,1),Buffer.from('100644 a\0'),Buffer.alloc(20,1)])],
 ['missing child',Buffer.concat([Buffer.from('40000 a\0'),Buffer.alloc(20,1)])],
])test('hash-valid raw graph rejects '+label+' pre-I/O',async()=>{
 const p=plan();p.trees=[{path:'',body,oid:hash('tree',body)}];
 await assert.rejects(publishCommitObjects({...p,gitDirectory:'bad',assertAuthorized(){assert.fail('no I/O');},onStart(){assert.fail('no start');}}));
});

test('own getters, symbols and extended arrays rejected without evaluating getters',async()=>{
 const base={...plan(),gitDirectory:'bad',assertAuthorized(){assert.fail();},onStart(){assert.fail();}};
 for(const location of ['options','tree','commit','array']){
  const p={...base,...plan()};let calls=0;
  const target=location==='options'?p:location==='tree'?p.trees[0]:location==='commit'?p.commit:p.trees;
  Object.defineProperty(target,location==='array'?'0':location==='options'?'signal':'oid',{get(){calls++;throw Error('getter');},configurable:true});
  await assert.rejects(publishCommitObjects(p));assert.equal(calls,0);
 }
 const p={...base,[Symbol('extra')]:1};await assert.rejects(publishCommitObjects(p));
 const q={...base,...plan()};q.trees.extra=1;await assert.rejects(publishCommitObjects(q));
});

test('partial publish cancellation retains first object and reports unknown',async t=>{
 const f=await fixture(t),controller=new AbortController();let starts=0;
 await assert.rejects(publishCommitObjects({...f.options,signal:controller.signal,onStart(){starts++;},assertAuthorized(){if(existsSync(f.target(f.options.trees[0].oid)))controller.abort();}}),unknown);
 assert.equal(starts,1);assert.deepEqual(f.git('cat-file','tree',f.options.trees[0].oid),f.options.trees[0].body);
 assert.equal(existsSync(f.target(f.options.commit.oid)),false);
});
test('revocation and cancellation before start preserve original failures',async t=>{
 const f=await fixture(t),denied=new Error('denied');
 await assert.rejects(publishCommitObjects({...f.options,assertAuthorized(){throw denied;},onStart(){assert.fail();}}),e=>e===denied);
 const c=new AbortController();c.abort(denied);
 await assert.rejects(publishCommitObjects({...f.options,signal:c.signal,onStart(){assert.fail();}}),e=>e===denied);
 assert.deepEqual((await readdir(path.join(f.gitDirectory,'objects'))).sort(),['info','pack']);
});
for(const callback of [()=>{throw Error('start failed');},()=>Promise.reject(Error('async start'))])test('start callback failure is unknown',async t=>{
 const f=await fixture(t);await assert.rejects(publishCommitObjects({...f.options,onStart:callback}),unknown);
});
test('empty root graph publishes and repeated identical subtree OIDs create only once',async t=>{
 const f=await fixture(t);
 for(const entries of [[],[{path:'a/x',mode:'100644',oid:'1'.repeat(40)},{path:'b/x',mode:'100644',oid:'1'.repeat(40)}]]){
  const graph=buildIndexTree(entries),commit=encodeGitCommit({tree:graph.root,author:identity,committer:identity,message:''});
  const result=await publishCommitObjects({...f.options,trees:graph.trees,commit});
  assert.equal(result.tree,graph.root);assert.equal(new Set(result.created.map(o=>o.oid)).size,result.created.length);
  for(const tree of graph.trees)assert.deepEqual(f.git('cat-file','tree',tree.oid),tree.body);
 }
});
test('existing first child does not start until first missing object',async t=>{
 const f=await fixture(t),first=f.options.trees[0];
 const {storeCapturedObject}=await import('../git-object-store.mjs');
 await storeCapturedObject({gitDirectory:f.gitDirectory,objectFormat:'sha1',type:'tree',bytes:first.body,assertAuthorized(){},onStart(){}});
 let starts=0;
 const result=await publishCommitObjects({...f.options,onStart(){starts++;assert.ok(existsSync(f.target(first.oid)));assert.equal(existsSync(f.target(f.options.trees[1].oid)),false);}});
 assert.equal(starts,1);assert.ok(!result.created.some(o=>o.oid===first.oid));
});
test('inherits enclosing shared deadline before mutation',async t=>{
 const f=await fixture(t);
 await assert.rejects(withOperationBudget({timeoutMs:5},()=>publishCommitObjects({...f.options,assertAuthorized:()=>new Promise(resolve=>setTimeout(resolve,20)),onStart(){assert.fail();}})),e=>e.code==='TIMEOUT');
});
