import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createIndexCommitPlan} from '../src/commit-plan.mjs';
import {encodeGitCommit} from '../src/git-commit-object.mjs';

const person={name:'测试 Author',email:'test@example.invalid',timestamp:1700000000,timezone:'+0800'};
const hash=(bytes,format='sha256')=>createHash(format).update(bytes).digest('hex');
const options=(objectFormat='sha1')=>({objectFormat,parent:'a'.repeat(objectFormat==='sha1'?40:64),parentTree:'b'.repeat(objectFormat==='sha1'?40:64),author:{...person},committer:{...person,timestamp:1700000100,timezone:'-0700'},message:' message\u000d\u000a正文 without final newline '});
function index(objectFormat='sha1'){
 const width=objectFormat==='sha1'?20:32,header=Buffer.alloc(12);
 header.write('DIRC');header.writeUInt32BE(2,4);header.writeUInt32BE(1,8);
 const name=Buffer.from('dir/file'),fixed=42+width,entry=Buffer.alloc(Math.ceil((fixed+name.length+1)/8)*8);
 entry.writeUInt32BE(0o100644,24);entry.fill(0xcc,40,40+width);entry.writeUInt16BE(name.length,40+width);name.copy(entry,fixed);
 return checksum(Buffer.concat([header,entry]),objectFormat);
}
function checksum(body,format='sha1'){return Buffer.concat([body,createHash(format).update(body).digest()]);}
function modified(raw,mutate,format='sha1'){
 const body=Buffer.from(raw.subarray(0,raw.length-(format==='sha1'?20:32)));mutate(body);return checksum(body,format);
}
function extension(raw,signature,format='sha1',payload=Buffer.from('opaque cache')){
 const header=Buffer.alloc(8);header.write(signature,0,'ascii');header.writeUInt32BE(payload.length,4);
 return checksum(Buffer.concat([raw.subarray(0,raw.length-(format==='sha1'?20:32)),header,payload]),format);
}

for(const objectFormat of ['sha1','sha256'])test('canonical exact-byte plan and identity binding: '+objectFormat,()=>{
 const raw=index(objectFormat),input=options(objectFormat),plan=createIndexCommitPlan(raw,input);
 assert.deepEqual(plan,createIndexCommitPlan(Buffer.from(raw),input));
 assert.equal(plan.indexDigest,hash(raw));assert.equal(plan.objectFormat,objectFormat);
 assert.equal(plan.parent,input.parent);assert.equal(plan.parentTree,input.parentTree);
 assert.equal(plan.tree,plan.trees.at(-1).oid);assert.equal(plan.trees.at(-1).path,'');
 assert.deepEqual(plan.trees.map(tree=>tree.path),['dir','']);
 assert.deepEqual(plan.commit,encodeGitCommit({tree:plan.tree,parents:[input.parent],author:input.author,committer:input.committer,message:input.message},{objectFormat}));
 assert.equal(plan.id,hash(JSON.stringify(['dsh-index-commit-plan-v1',plan.indexDigest,objectFormat,input.parent,input.parentTree,plan.tree,plan.commit.oid])));
 const stat=modified(raw,body=>body.writeUInt32BE(42,12),objectFormat),statPlan=createIndexCommitPlan(stat,input);
 assert.equal(statPlan.tree,plan.tree);assert.equal(statPlan.commit.oid,plan.commit.oid);assert.notEqual(statPlan.indexDigest,plan.indexDigest);assert.notEqual(statPlan.id,plan.id);
 for(const patch of [{parent:'d'.repeat(input.parent.length)},{parentTree:'e'.repeat(input.parent.length)},{message:input.message+'\u000a'},{author:{...input.author,name:'Other'}},{committer:{...input.committer,timestamp:1700000101}}])assert.notEqual(createIndexCommitPlan(raw,{...input,...patch}).id,plan.id);
});

test('index is copied before option access and results own mutable bytes with frozen metadata',()=>{
 const raw=index(),saved=Buffer.from(raw),input=options(),message=Buffer.from(input.message);
 let invoked=0;assert.throws(()=>createIndexCommitPlan(raw,{...input,message,get objectFormat(){invoked++;raw.fill(0);return 'sha1';}}));assert.equal(invoked,0);assert.deepEqual(raw,saved);
 const plan=createIndexCommitPlan(raw,{...input,message});raw.fill(0);
 const again=createIndexCommitPlan(saved,{...input,message});
 assert.equal(plan.indexDigest,hash(saved));message.fill(0);assert.deepEqual(plan,again);
 for(const metadata of [plan,plan.commit,plan.trees,...plan.trees])assert.equal(Object.isFrozen(metadata),true);
 assert.throws(()=>{plan.tree='changed';},TypeError);assert.equal(Object.isFrozen(plan.commit.body),false);
 const buffers=[plan.commit.body,...plan.trees.map(tree=>tree.body)];
 for(let i=0;i<buffers.length;i++){
  assert.notStrictEqual(buffers[i].buffer,saved.buffer);
  for(let j=i+1;j<buffers.length;j++)assert.notStrictEqual(buffers[i].buffer,buffers[j].buffer);
 }
 plan.commit.body.fill(0);plan.trees[0].body.fill(0);
 assert.notDeepEqual(plan.commit.body,again.commit.body);assert.notDeepEqual(plan.trees[0].body,again.trees[0].body);
 assert.deepEqual(plan.trees[1].body,again.trees[1].body);assert.deepEqual(createIndexCommitPlan(saved,input),again);
});

test('default SHA-1, empty index and inclusive raw byte bound',()=>{
 const input=options(),header=Buffer.alloc(12);header.write('DIRC');header.writeUInt32BE(2,4);
 const empty=checksum(header),{objectFormat,...defaults}=input;
 const plan=createIndexCommitPlan(empty,defaults);
 assert.equal(plan.objectFormat,'sha1');assert.equal(plan.tree,'4b825dc642cb6eb9a060e54bf8d69288fbee4904');
 assert.equal(plan.trees.length,1);assert.equal(plan.trees[0].body.length,0);
 assert.throws(()=>createIndexCommitPlan(empty,{...input,parentTree:plan.tree}),/no-op/);
 const raw=index(),payload=Buffer.alloc(8*1024*1024-raw.length-8,1),bounded=extension(raw,'TREE','sha1',payload);
 assert.equal(bounded.length,8*1024*1024);assert.doesNotThrow(()=>createIndexCommitPlan(bounded,input));
 assert.throws(()=>createIndexCommitPlan(extension(raw,'TREE','sha1',Buffer.alloc(payload.length+1)),input),/byte limit/);
});

test('rejects wrong buffer, oversized, corrupt and unverifiable checksums',()=>{
 for(const raw of [undefined,null,'index',new Uint8Array(index()),Buffer.alloc(0)])assert.throws(()=>createIndexCommitPlan(raw,options()));
 assert.throws(()=>createIndexCommitPlan(Buffer.alloc(8*1024*1024+1),options()),/byte limit/);
 const corrupt=index();corrupt[20]^=1;assert.throws(()=>createIndexCommitPlan(corrupt,options()),/checksum/);
 const zero=index();zero.fill(0,zero.length-20);assert.throws(()=>createIndexCommitPlan(zero,options()),/skipHash/);
 assert.throws(()=>createIndexCommitPlan(index('sha256'),options()),/checksum/);
});

for(const objectFormat of ['sha1','sha256'])test('only stage-0 regular files and approved opaque caches: '+objectFormat,()=>{
 const raw=index(objectFormat),input=options(objectFormat),expected=createIndexCommitPlan(raw,input),width=objectFormat==='sha1'?20:32;
 let all=raw;
 for(const name of ['TREE','EOIE','IEOT']){
  all=extension(all,name,objectFormat);const plan=createIndexCommitPlan(all,input);
  assert.equal(plan.tree,expected.tree);assert.equal(plan.commit.oid,expected.commit.oid);assert.notEqual(plan.id,expected.id);
 }
 for(const name of ['REUC','UNTR','FSMN','ABCD','link','sdir'])assert.throws(()=>createIndexCommitPlan(extension(raw,name,objectFormat),input),/extension/);
 for(const flag of [0x1000,0x2000,0x3000,0x4000,0x8000])assert.throws(()=>createIndexCommitPlan(modified(raw,b=>b.writeUInt16BE(flag|8,12+40+width),objectFormat),input),/stage 0|flags/);
 for(const mode of [0o120000,0o160000,0o40000])assert.throws(()=>createIndexCommitPlan(modified(raw,b=>b.writeUInt32BE(mode,12+24),objectFormat),input),/mode/);
 assert.throws(()=>createIndexCommitPlan(modified(raw,b=>b.fill(0,52,52+width),objectFormat),input),/object id/);
});

test('requires born full-width same-format parents and rejects explicit no-op',()=>{
 for(const format of ['sha1','sha256']){
  const raw=index(format),input=options(format),plan=createIndexCommitPlan(raw,input);
  for(const key of ['parent','parentTree'])for(const value of [undefined,null,[],[input.parent],'',input.parent.slice(1),'0'.repeat(input.parent.length),'A'.repeat(input.parent.length),'a'.repeat(format==='sha1'?64:40)])assert.throws(()=>createIndexCommitPlan(raw,{...input,[key]:value}),/object id/);
  assert.throws(()=>createIndexCommitPlan(raw,{...input,parentTree:plan.tree}),/no-op/);
  // Pure input binding, not repository freshness verification: syntactically valid
  // stale or absent IDs remain accepted, and yield a different plan identity.
  assert.notEqual(createIndexCommitPlan(raw,{...input,parent:'f'.repeat(input.parent.length)}).id,plan.id);
 }
 for(const objectFormat of ['SHA1','sha512',null])assert.throws(()=>createIndexCommitPlan(index(),{...options(),objectFormat}),/format/);
});

test('rejects missing blank unsafe and oversized messages; preserves nonblank exact bytes',()=>{
 const raw=index(),input=options();
 for(const message of [undefined,null,'',' \u000d\u000a\u0009　',Buffer.from('  \u000a'),'a\u0000b','\ud800',Buffer.from([255]),new Uint8Array([97]),'a'.repeat(65537),Buffer.alloc(65537,97)])assert.throws(()=>createIndexCommitPlan(raw,{...input,message}));
 for(const message of [' text ','﻿text','text','text\u000a','text\u000d\u000a',Buffer.from(' text\u000a')]){
  const plan=createIndexCommitPlan(raw,{...input,message});assert.ok(plan.commit.body.subarray(plan.commit.body.indexOf('\u000a\u000a')+2).equals(Buffer.from(message)));
 }
});

test('identity and time validation exactly delegates to encoder',()=>{
 const raw=index(),input=options();
 for(const role of ['author','committer'])for(const patch of [{name:''},{name:'a\u000ab'},{email:'a<b'},{name:'\ud800'},{timestamp:-1},{timestamp:1.5},{timestamp:'1700000000'},{timestamp:Number.MAX_SAFE_INTEGER+1},{timezone:'+0060'},{timezone:'+1401'},{timezone:'+0800\u000a'}])assert.throws(()=>createIndexCommitPlan(raw,{...input,[role]:{...person,...patch}}));
 for(const role of ['author','committer'])for(const value of [undefined,null,{}])assert.throws(()=>createIndexCommitPlan(raw,{...input,[role]:value}));
 assert.doesNotThrow(()=>createIndexCommitPlan(raw,{...input,author:{...person,timestamp:0,timezone:'-1400'}}));
});

test('cancellation checks every boundary synchronously with no ambient signal',()=>{
 const raw=index(),input=options(),controller=new AbortController(),reason=new Error('stop');controller.abort(reason);
 assert.throws(()=>createIndexCommitPlan(raw,{...input,signal:controller.signal}),error=>error===reason);
 let checks=0;createIndexCommitPlan(raw,{...input,signal:{throwIfAborted(){checks++;}}});assert.equal(checks,5);
 for(let phase=1;phase<=checks;phase++){
  let count=0;assert.throws(()=>createIndexCommitPlan(raw,{...input,signal:{throwIfAborted(){if(++count===phase)throw reason;}}}),error=>error===reason);
 }
 assert.ok(createIndexCommitPlan(raw,input));
});

for(const objectFormat of ['sha1','sha256'])test('real Git add/write-tree and exact commit-tree oracle without refs: '+objectFormat,()=>{
 const cwd=mkdtempSync(path.join(tmpdir(),'vcs-commit-plan-')),env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
 Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(cwd,'absent-config')});
 const input=options(objectFormat);
 for(const [role,value] of [['AUTHOR',input.author],['COMMITTER',input.committer]])Object.assign(env,{['GIT_'+role+'_NAME']:value.name,['GIT_'+role+'_EMAIL']:value.email,['GIT_'+role+'_DATE']:'@'+value.timestamp+' '+value.timezone});
 const git=(args,bytes,encoding='utf8')=>execFileSync('git',args,{cwd,env,input:bytes,encoding,windowsHide:true,maxBuffer:2*1024*1024});
 try{
  git(['init','--quiet','--object-format='+objectFormat]);git(['config','core.autocrlf','false']);git(['config','index.version','2']);
  mkdirSync(path.join(cwd,'dir'));writeFileSync(path.join(cwd,'dir','file'),'parent\u000a');git(['add','--','dir/file']);
  input.parentTree=git(['write-tree']).trim();input.parent=git(['commit-tree',input.parentTree],Buffer.from('parent\u000a')).trim();
  const head=readFileSync(path.join(cwd,'.git','HEAD'));
  writeFileSync(path.join(cwd,'dir','file'),'staged\u000a');writeFileSync(path.join(cwd,'new file'),'new\u000a');git(['add','--','dir/file','new file']);
  const raw=readFileSync(path.join(cwd,'.git','index')),plan=createIndexCommitPlan(raw,input);
  writeFileSync(path.join(cwd,'dir','file'),'unstaged different\u000a');
  assert.equal(git(['write-tree']).trim(),plan.tree);
  for(const tree of plan.trees){assert.equal(git(['hash-object','-t','tree','--stdin'],tree.body).trim(),tree.oid);assert.deepEqual(git(['cat-file','tree',tree.oid],undefined,'buffer'),tree.body);}
  assert.equal(git(['hash-object','-t','commit','--stdin'],plan.commit.body).trim(),plan.commit.oid);
  // commit-tree normalizes a missing final newline; feed this oracle a message
  // already ending in LF and check both object ID and actual object bytes.
  const withLF=createIndexCommitPlan(raw,{...input,message:'exact oracle 正文\u000a'});
  const actual=git(['commit-tree',plan.tree,'-p',input.parent],Buffer.from('exact oracle 正文\u000a')).trim();
  assert.equal(actual,withLF.commit.oid);assert.deepEqual(git(['cat-file','commit',actual],undefined,'buffer'),withLF.commit.body);
  assert.deepEqual(readFileSync(path.join(cwd,'.git','HEAD')),head);assert.equal(git(['for-each-ref']).trim(),'');
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
