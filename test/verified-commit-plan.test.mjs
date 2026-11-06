import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createVerifiedIndexCommitPlan as plan} from '../src/verified-commit-plan.mjs';
import {createIndexCommitPlan} from '../src/commit-plan.mjs';

const person={name:'A',email:'a@example.invalid',timestamp:1700000000,timezone:'+0000'};
const hash=(bytes,format='sha1')=>createHash(format).update(bytes).digest();
const commitHash=(bytes,format='sha1')=>createHash(format).update('commit '+bytes.length+'\0').update(bytes).digest('hex');
function fixture(objectFormat='sha1',tree='1'.repeat(objectFormat==='sha1'?40:64)){
 const header=Buffer.alloc(12);header.write('DIRC');header.writeUInt32BE(2,4);
 const index=Buffer.concat([header,hash(header,objectFormat)]);
 const parentBody=Buffer.from('tree '+tree+'\nauthor A <a@example.invalid> 1 +0000\ncommitter A <a@example.invalid> 1 +0000\n\nparent message');
 const inputs={objectFormat,parent:commitHash(parentBody,objectFormat),author:{...person},committer:{...person},message:Buffer.from('new message\n')};
 return {index,parentBody,inputs,tree};
}
const run=f=>plan(f.index,f.parentBody,f.inputs);
for(const format of ['sha1','sha256'])test('verified literal parent and existing plan shape: '+format,()=>{
 const f=fixture(format),actual=run(f);
 assert.deepEqual(actual,createIndexCommitPlan(f.index,{...f.inputs,parentTree:f.tree}));
 assert.equal(actual.parentTree,f.tree);assert.equal(actual.parent,f.inputs.parent);
 assert.deepEqual(Object.keys(actual),['id','objectFormat','indexDigest','parent','parentTree','tree','commit','trees']);
 const changed=fixture(format);changed.parentBody=Buffer.concat([changed.parentBody,Buffer.from('different')]);changed.inputs.parent=commitHash(changed.parentBody,format);
 assert.notEqual(run(changed).id,actual.id);
});

test('defaults SHA-1 and accepts null-prototype own data records',()=>{
 const f=fixture();delete f.inputs.objectFormat;
 for(const role of ['author','committer'])f.inputs[role]=Object.assign(Object.create(null),f.inputs[role]);
 f.inputs=Object.assign(Object.create(null),f.inputs);assert.equal(run(f).objectFormat,'sha1');
});

for(const format of ['sha1','sha256'])test('mismatched parent, raw tamper, hash-correct malformed header and forged message: '+format,()=>{
 const f=fixture(format),original=Buffer.from(f.parentBody);
 f.inputs.parent='2'.repeat(f.inputs.parent.length);assert.throws(()=>run(f),/mismatch/);
 f.inputs.parent=commitHash(original,format);f.parentBody[5]=0x33;assert.throws(()=>run(f),/mismatch/);
 for(const bytes of [Buffer.from('tree '+f.tree+'\ntree '+f.tree+'\nauthor A <a@x> 1 +0000\ncommitter A <a@x> 1 +0000\n\nx'),Buffer.from('author A <a@x> 1 +0000\ncommitter A <a@x> 1 +0000\n\ntree '+f.tree)]){
  f.parentBody=bytes;f.inputs.parent=commitHash(bytes,format);assert.throws(()=>run(f),/header|required/);
 }
 f.parentBody=Buffer.concat([original,Buffer.from('\ntree '+'2'.repeat(f.tree.length))]);f.inputs.parent=commitHash(f.parentBody,format);
 assert.equal(run(f).parentTree,f.tree);
});

test('rejects extras symbols nonrecords and accessors without evaluating getters',()=>{
 const f=fixture();let calls=0;
 for(const field of ['parentTree','other',Symbol('extra')])assert.throws(()=>plan(f.index,f.parentBody,{...f.inputs,[field]:f.tree}),/Unsupported/);
 for(const value of [null,[],new Date(),Object.create(f.inputs)])assert.throws(()=>plan(f.index,f.parentBody,value),/record/);
 for(const role of [null,'author','committer']){
  const target=role?{...f.inputs[role]}:{...f.inputs},key=role?'name':'objectFormat';
  Object.defineProperty(target,key,{get(){calls++;f.index.fill(0);f.parentBody.fill(0);throw Error('evaluated');},enumerable:true});
  assert.throws(()=>plan(f.index,f.parentBody,role?{...f.inputs,[role]:target}:target),/own data/);
 }
 assert.equal(calls,0);
 for(const role of ['author','committer'])for(const patch of [{extra:1},{[Symbol('x')]:1}])assert.throws(()=>plan(f.index,f.parentBody,{...f.inputs,[role]:{...person,...patch}}),/Unsupported/);
});

test('both raw snapshots precede input and identity descriptor traps',()=>{
 for(const role of [null,'author','committer']){
  const f=fixture(),expected=run(f),target=role?f.inputs[role]:f.inputs;
  const proxy=new Proxy(target,{getPrototypeOf(value){f.index.fill(0);f.parentBody.fill(0);return Reflect.getPrototypeOf(value);}});
  const inputs=role?{...f.inputs,[role]:proxy}:proxy;
  assert.deepEqual(plan(f.index,f.parentBody,inputs),expected);
 }
});

test('callbacks cannot change captured buffers identities options or message',()=>{
 const f=fixture(),expected=run(f);
 f.inputs.signal={throwIfAborted(){f.index.fill(0);f.parentBody.fill(0);f.inputs.message.fill(0);f.inputs.author.name='Changed';f.inputs.committer.timestamp=0;f.inputs.parent='f'.repeat(40);}};
 assert.deepEqual(run(f),expected);
});

test('frozen metadata and independent mutable owned output buffers',()=>{
 const f=fixture(),actual=run(f),expected=run(f);
 f.index.fill(0);f.parentBody.fill(0);f.inputs.message.fill(0);assert.deepEqual(actual,expected);
 for(const metadata of [actual,actual.commit,actual.trees,...actual.trees])assert.ok(Object.isFrozen(metadata));
 const bodies=[actual.commit.body,...actual.trees.map(t=>t.body)];
 for(let i=0;i<bodies.length;i++){
  assert.equal(Object.isFrozen(bodies[i]),false);
  for(const source of [f.index,f.parentBody,f.inputs.message,...bodies.slice(i+1)])assert.notStrictEqual(bodies[i].buffer,source.buffer);
 }
 actual.commit.body.fill(0);assert.notDeepEqual(actual.commit.body,expected.commit.body);assert.deepEqual(actual.trees,expected.trees);
});

test('derived equal parent tree rejects no-op for both formats',()=>{
 for(const format of ['sha1','sha256']){
  const f=fixture(format),tree=run(f).tree,noOp=fixture(format,tree);assert.throws(()=>run(noOp),/no-op/);
 }
});

test('raw type and size bounds precede options inspection; inclusive limits work',()=>{
 let accesses=0;const inputs=new Proxy({},{getPrototypeOf(){accesses++;throw Error('options inspected');}}),f=fixture();
 for(const raw of [undefined,null,'x',new Uint8Array(),Buffer.alloc(8*1024*1024+1)])assert.throws(()=>plan(raw,f.parentBody,inputs),/Buffer|byte limit/);
 for(const raw of [undefined,null,'x',new Uint8Array(),Buffer.alloc(2*1024*1024+1)])assert.throws(()=>plan(f.index,raw,inputs),/Buffer|byte limit/);
 assert.equal(accesses,0);
 const body=f.index.subarray(0,12),extension=Buffer.alloc(8);extension.write('TREE');extension.writeUInt32BE(8*1024*1024-f.index.length-8,4);
 const indexBody=Buffer.concat([body,extension,Buffer.alloc(extension.readUInt32BE(4))]);f.index=Buffer.concat([indexBody,hash(indexBody)]);
 f.parentBody=Buffer.concat([f.parentBody,Buffer.alloc(2*1024*1024-f.parentBody.length,97)]);f.inputs.parent=commitHash(f.parentBody);
 assert.equal(f.index.length,8*1024*1024);assert.equal(f.parentBody.length,2*1024*1024);assert.doesNotThrow(()=>run(f));
});

test('cancellation checks all synchronous phase boundaries',()=>{
 const f=fixture(),controller=new AbortController(),reason=new Error('cancelled');controller.abort(reason);
 assert.throws(()=>plan(f.index,f.parentBody,{...f.inputs,signal:controller.signal}),error=>error===reason);
 let checks=0;plan(f.index,f.parentBody,{...f.inputs,signal:{throwIfAborted(){checks++;}}});assert.ok(checks>=8);
 for(let phase=1;phase<=checks;phase++){
  let count=0;assert.throws(()=>plan(f.index,f.parentBody,{...f.inputs,signal:{throwIfAborted(){if(++count===phase)throw reason;}}}),error=>error===reason);
 }
});

for(const format of ['sha1','sha256'])test('actual temporary Git parent and index, no ref publication: '+format,()=>{
 const cwd=mkdtempSync(path.join(tmpdir(),'vcs-verified-plan-')),env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
 Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(cwd,'absent-config')});
 for(const role of ['AUTHOR','COMMITTER'])Object.assign(env,{['GIT_'+role+'_NAME']:person.name,['GIT_'+role+'_EMAIL']:person.email,['GIT_'+role+'_DATE']:'@'+person.timestamp+' '+person.timezone});
 const git=(args,input,encoding='utf8')=>execFileSync('git',args,{cwd,env,input,encoding,windowsHide:true,maxBuffer:4*1024*1024});
 try{
  git(['init','--quiet','--object-format='+format]);git(['config','core.autocrlf','false']);git(['config','index.version','2']);
  writeFileSync(path.join(cwd,'file'),'parent\n');git(['add','--','file']);
  const parentTree=git(['write-tree']).trim(),parent=git(['commit-tree',parentTree],Buffer.from('parent\n')).trim(),parentBody=git(['cat-file','commit',parent],undefined,'buffer');
  writeFileSync(path.join(cwd,'file'),'changed\n');git(['add','--','file']);
  const index=readFileSync(path.join(cwd,'.git','index')),head=readFileSync(path.join(cwd,'.git','HEAD'));
  const actual=plan(index,parentBody,{objectFormat:format,parent,author:person,committer:person,message:'oracle\n'});
  assert.equal(actual.parentTree,parentTree);assert.equal(actual.tree,git(['write-tree']).trim());
  assert.equal(actual.commit.oid,git(['commit-tree',actual.tree,'-p',parent],Buffer.from('oracle\n')).trim());
  assert.deepEqual(actual.commit.body,git(['cat-file','commit',actual.commit.oid],undefined,'buffer'));
  assert.deepEqual(readFileSync(path.join(cwd,'.git','HEAD')),head);assert.equal(git(['for-each-ref']).trim(),'');
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
