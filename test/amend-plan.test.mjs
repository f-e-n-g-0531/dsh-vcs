import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createAmendPlan as plan} from '../src/amend-plan.mjs';
import {encodeGitCommit,encodeGitTree} from '../src/git-commit-object.mjs';
import {readVerifiedCommitMetadata} from '../src/verified-commit-metadata.mjs';

const author={name:'  Original Å  ',email:' original@example.invalid ',timestamp:1,timezone:'-0000'};
const committer={name:'New Committer',email:'new@example.invalid',timestamp:1700000000,timezone:'+0530'};
const hash=(bytes,format='sha1')=>createHash(format).update(bytes).digest();
const objectHash=(body,format='sha1',type='commit')=>createHash(format).update(type+' '+body.length+'\0').update(body).digest('hex');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(objectFormat='sha1',count=0){
 const header=Buffer.alloc(12);header.write('DIRC');header.writeUInt32BE(2,4);
 const index=Buffer.concat([header,hash(header,objectFormat)]),width=objectFormat==='sha1'?40:64;
 const parents=Array.from({length:count},(_,i)=>(i+1).toString(16).padStart(width,'0'));
 const previous=encodeGitCommit({tree:encodeGitTree([],{objectFormat}).oid,parents,author,committer:author,message:'original\n'},{objectFormat});
 return {index,headBody:previous.body,inputs:{objectFormat,head:previous.oid,committer:{...committer},message:Buffer.from(' amended\r\nmessage\t ')},parents};
}
const run=f=>plan(f.index,f.headBody,f.inputs);
function replaceBody(f,text){f.headBody=Buffer.from(text);f.inputs.head=objectHash(f.headBody,f.inputs.objectFormat);}
function extension(f,signature,payload=Buffer.alloc(0)){
 const width=f.inputs.objectFormat==='sha1'?20:32,header=Buffer.alloc(8);header.write(signature);header.writeUInt32BE(payload.length,4);
 const body=Buffer.concat([f.index.subarray(0,-width),header,payload]);f.index=Buffer.concat([body,hash(body,f.inputs.objectFormat)]);
}
for(const format of ['sha1','sha256'])for(const count of [0,1,2,16])test('preserves exact author and ordered parents '+format+'/'+count,()=>{
 const f=fixture(format,count),p=run(f),old=readVerifiedCommitMetadata(f.headBody,{oid:f.inputs.head,objectFormat:format});
 assert.deepEqual(p.author,old.author);assert.deepEqual(p.parents,f.parents);assert.deepEqual(p.committer,committer);
 assert.equal(p.previousTree,old.tree);assert.equal(p.tree,old.tree);assert.equal(p.message,f.inputs.message.toString());
 const expected=encodeGitCommit({tree:p.tree,parents:f.parents,author:old.author,committer,message:f.inputs.message},{objectFormat:format});
 assert.deepEqual(p.commit,expected);assert.equal(p.commit.oid,objectHash(p.commit.body,format));assert.ok(!p.parents.includes(p.head));
 assert.equal(p.id,sha256(JSON.stringify(['dsh-amend-plan-v1',sha256(f.index),format,p.head,old.tree,f.parents,p.tree,p.commit.oid])));
 assert.deepEqual(Object.keys(p),['id','objectFormat','indexDigest','head','previousTree','parents','author','committer','message','tree','commit','trees']);
});

test('same-tree message-only and committer-only amendments; reject only exact commit no-op',()=>{
 for(const format of ['sha1','sha256']){
  const f=fixture(format);f.inputs.committer={...author};assert.notEqual(run(f).commit.oid,f.inputs.head);
  f.inputs.message='original\n';assert.throws(()=>run(f),/no-op/);
  for(const patch of [{name:'Other'},{email:'other@x'},{timestamp:2},{timezone:'+0000'}]){
   f.inputs.committer={...author,...patch};assert.notEqual(run(f).commit.oid,f.inputs.head);
  }
 }
});

test('optional UTF-8 encoding accepted; signed and malformed authenticated HEAD rejected',()=>{
 const f=fixture();replaceBody(f,f.headBody.toString().replace('\n\n','\nencoding UTF-8\n\n'));assert.deepEqual(run(f).author,author);
 for(const header of ['gpgsig signature','gpgsig-sha256 signature','mergetag tag','encoding latin1','tree '+'1'.repeat(40),' continuation']){
  const x=fixture();replaceBody(x,x.headBody.toString().replace('\n\n','\n'+header+'\n\n'));assert.throws(()=>run(x),/header|continuation/);
 }
 for(const count of [17]){
  const x=fixture('sha1',16);replaceBody(x,x.headBody.toString().replace('author ','parent '+'f'.repeat(40)+'\nauthor '));assert.throws(()=>run(x),/parent limit/);
 }
 const x=fixture();replaceBody(x,x.headBody.toString().replace('author ','parent '+'0'.repeat(40)+'\nauthor '));assert.throws(()=>run(x),/object id/);
});

test('HEAD authentication, invalid ids, formats and index checksums',()=>{
 for(const format of ['sha1','sha256']){
  const f=fixture(format);
  for(const head of [undefined,null,1,'0'.repeat(f.inputs.head.length),f.inputs.head.toUpperCase(),'1'.repeat(f.inputs.head.length-1),'f'.repeat(f.inputs.head.length)])assert.throws(()=>plan(f.index,f.headBody,{...f.inputs,head}),/object id|mismatch/);
  f.headBody[f.headBody.length-1]^=1;assert.throws(()=>run(f),/mismatch/);
  const x=fixture(format);x.index[0]^=1;assert.throws(()=>run(x),/checksum/);
 }
 const f=fixture();assert.throws(()=>plan(f.index,f.headBody,{...f.inputs,objectFormat:'sha512'}),/format/);
});

test('strict own-data options and committer; no overrides getters symbols or inherited state',()=>{
 const f=fixture();let calls=0;
 for(const key of ['author','parents','parent','parentTree','tree','encoding','other',Symbol('extra')])assert.throws(()=>plan(f.index,f.headBody,{...f.inputs,[key]:author}),/Unsupported/);
 for(const value of [null,[],new Date(),Object.create(f.inputs)])assert.throws(()=>plan(f.index,f.headBody,value),/record/);
 for(const key of ['name','email','timestamp','timezone']){
  const person={...committer};Object.defineProperty(person,key,{get(){calls++;throw Error('evaluated');}});
  assert.throws(()=>plan(f.index,f.headBody,{...f.inputs,committer:person}),/own data/);
 }
 for(const key of ['head','objectFormat','committer','message','signal']){
  const inputs={...f.inputs};Object.defineProperty(inputs,key,{get(){calls++;throw Error('evaluated');}});assert.throws(()=>plan(f.index,f.headBody,inputs),/own data/);
 }
 for(const extra of [{x:1},{[Symbol('x')]:1}])assert.throws(()=>plan(f.index,f.headBody,{...f.inputs,committer:{...committer,...extra}}),/Unsupported/);
 assert.equal(calls,0);
 delete f.inputs.objectFormat;f.inputs=Object.assign(Object.create(null),f.inputs);f.inputs.committer=Object.assign(Object.create(null),committer);assert.equal(run(f).objectFormat,'sha1');
});

test('both raw snapshots precede every options and committer proxy trap',()=>{
 for(const role of ['inputs','committer'])for(const trap of ['getPrototypeOf','ownKeys','getOwnPropertyDescriptor']){
  const f=fixture(),expected=run(f),target=role==='inputs'?f.inputs:f.inputs.committer;
  const proxy=new Proxy(target,{[trap](...args){f.index.fill(0);f.headBody.fill(0);return Reflect[trap](...args);}});
  assert.deepEqual(plan(f.index,f.headBody,role==='inputs'?proxy:{...f.inputs,committer:proxy}),expected);
 }
});

test('message and scalar committer captured before any signal callback/getter',()=>{
 for(const kind of ['method','abortedGetter','methodGetter']){
  const f=fixture(),expected=run(f);const mutate=()=>{f.index.fill(0);f.headBody.fill(0);f.inputs.message.fill(0);f.inputs.committer.name='tamper';f.inputs.committer.timestamp=0;f.inputs.head='f'.repeat(40);};
  const signal=kind==='method'?{throwIfAborted:mutate}:kind==='abortedGetter'?{get aborted(){mutate();return false;}}:{get throwIfAborted(){mutate();return ()=>{};}};
  f.inputs.signal=signal;assert.deepEqual(run(f),expected);
 }
});

test('owned mutable bodies and frozen metadata, independent across outputs and callers',()=>{
 const f=fixture(),p=run(f),expected=run(f);f.index.fill(0);f.headBody.fill(0);f.inputs.message.fill(0);assert.deepEqual(p,expected);
 for(const value of [p,p.commit,p.trees,p.parents,p.author,p.committer,...p.trees])assert.ok(Object.isFrozen(value));
 for(const body of [p.commit.body,...p.trees.map(t=>t.body)]){
  assert.equal(Object.isFrozen(body),false);for(const input of [f.index,f.headBody,f.inputs.message])assert.notStrictEqual(body.buffer,input.buffer);
 }
 p.commit.body.fill(0);assert.deepEqual(p.trees,expected.trees);assert.notDeepEqual(p.commit.body,expected.commit.body);
});

test('bounded raw inputs rejected before options traps; exact index bound accepted',()=>{
 const f=fixture();let inspected=0;const inputs=new Proxy({},{getPrototypeOf(){inspected++;throw Error('trap');}});
 for(const raw of [undefined,null,'x',new Uint8Array(),Buffer.alloc(8*1024*1024+1)])assert.throws(()=>plan(raw,f.headBody,inputs),/Buffer|byte limit/);
 for(const raw of [undefined,null,'x',new Uint8Array(),Buffer.alloc(2*1024*1024+1)])assert.throws(()=>plan(f.index,raw,inputs),/Buffer|byte limit/);
 assert.equal(inspected,0);extension(f,'TREE',Buffer.alloc(8*1024*1024-f.index.length-8));assert.equal(f.index.length,8*1024*1024);assert.ok(run(f));
});

test('only TREE EOIE IEOT opaque extensions permitted and their raw bytes bind ID',()=>{
 const f=fixture(),original=run(f);for(const signature of ['TREE','EOIE','IEOT'])extension(f,signature,Buffer.from('opaque'));
 const p=run(f);assert.equal(p.tree,original.tree);assert.equal(p.commit.oid,original.commit.oid);assert.notEqual(p.id,original.id);
 for(const signature of ['UNTR','FSMN','REUC','link']){const x=fixture();extension(x,signature);assert.throws(()=>run(x),/extension/);}
});

test('message exact UTF-8 nonblank and encoder bounds/identity policy',()=>{
 const f=fixture();for(const message of ['',Buffer.from(' \t\r\n'),'\ud800',Buffer.from([0xff]),'a\0b',Buffer.alloc(65537,65),'é'.repeat(32769),null,{}])assert.throws(()=>plan(f.index,f.headBody,{...f.inputs,message}),/message|UTF-8/);
 for(const message of ['a'.repeat(65536),Buffer.alloc(65536,65),'\ufeffmessage\r\n',' no final newline '])assert.equal(plan(f.index,f.headBody,{...f.inputs,message}).message,message.toString());
 for(const patch of [{timestamp:-1},{timestamp:Number.MAX_SAFE_INTEGER+1},{timestamp:'1'},{timezone:'+1460'},{name:'x\ny'},{email:' '},{name:'x'.repeat(1025)}])assert.throws(()=>plan(f.index,f.headBody,{...f.inputs,committer:{...committer,...patch}}),/identity/);
});

test('cancellation at every exposed phase never returns a partial plan',()=>{
 const f=fixture();const c=new AbortController();c.abort();assert.throws(()=>plan(f.index,f.headBody,{...f.inputs,signal:c.signal}),{name:'AbortError'});
 for(let phase=1;phase<=6;phase++){let calls=0;const marker=Error('cancel '+phase);assert.throws(()=>plan(f.index,f.headBody,{...f.inputs,signal:{throwIfAborted(){if(++calls===phase)throw marker;}}}),error=>error===marker);}
});

for(const format of ['sha1','sha256'])test('real temporary Git root/normal/merge hashes and trees '+format,()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'dsh-amend-plan-'));
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_AUTHOR_NAME:'Original',GIT_AUTHOR_EMAIL:'original@x',GIT_AUTHOR_DATE:'1700000000 +0000',GIT_COMMITTER_NAME:committer.name,GIT_COMMITTER_EMAIL:committer.email,GIT_COMMITTER_DATE:committer.timestamp+' '+committer.timezone};
 const git=(args,input)=>execFileSync('git',['-C',directory,...args],{input,env});
 try{
  git(['init','--object-format='+format]);git(['config','core.autocrlf','false']);mkdirSync(path.join(directory,'nested'));writeFileSync(path.join(directory,'nested','a.txt'),'one\n');git(['add','.']);
  const originalTree=git(['write-tree']).toString().trim(),root=git(['commit-tree',originalTree],Buffer.from('root\n')).toString().trim();
  const normal=git(['commit-tree',originalTree,'-p',root],Buffer.from('normal\n')).toString().trim();
  const branch=git(['commit-tree',originalTree,'-p',root],Buffer.from('branch\n')).toString().trim();
  const merge=git(['commit-tree',originalTree,'-p',normal,'-p',branch],Buffer.from('merge\n')).toString().trim();
  for(const changed of [false,true]){
   if(changed){writeFileSync(path.join(directory,'nested','a.txt'),'two\n');git(['add','.']);}
   const expectedTree=git(['write-tree']).toString().trim(),index=readFileSync(path.join(directory,'.git','index'));
   for(const [head,parents] of [[root,[]],[normal,[root]],[merge,[normal,branch]]]){
    const headBody=git(['cat-file','commit',head]),message=Buffer.from(' exact amended\r\nmessage '),p=plan(index,headBody,{objectFormat:format,head,committer,message});
    assert.equal(p.tree,expectedTree);assert.deepEqual(p.parents,parents);assert.deepEqual(p.author,readVerifiedCommitMetadata(headBody,{oid:head,objectFormat:format}).author);
    const parentArgs=parents.flatMap(oid=>['-p',oid]),expected=git(['commit-tree',expectedTree,...parentArgs],message).toString().trim();assert.equal(p.commit.oid,expected);
    assert.equal(git(['hash-object','-t','commit','--stdin'],p.commit.body).toString().trim(),expected);
    for(const tree of p.trees)assert.equal(git(['hash-object','-t','tree','--stdin'],tree.body).toString().trim(),tree.oid);
   }
  }
 }finally{rmSync(directory,{recursive:true,force:true});}
});
