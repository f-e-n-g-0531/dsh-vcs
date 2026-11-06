import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {readVerifiedCommitMetadata} from '../src/verified-commit-metadata.mjs';

const author={name:'原 Author',email:'a@example.invalid',timestamp:1700000000,timezone:'+0545'};
const committer={name:'Other Committer',email:'c@example.invalid',timestamp:1700000123,timezone:'-0330'};
const identity=p=>p.name+' <'+p.email+'> '+p.timestamp+' '+p.timezone;
const headers=(parents=[],width=40)=>['tree '+'a'.repeat(width),...parents.map(p=>'parent '+p),'author '+identity(author),'committer '+identity(committer)];
const body=(message='',lines=headers())=>Buffer.concat([Buffer.from(lines.join('\n')+'\n\n'),Buffer.isBuffer(message)?message:Buffer.from(message)]);
const hash=(bytes,format='sha1')=>createHash(format).update(Buffer.from('commit '+bytes.length+'\0')).update(bytes).digest('hex');
const read=(bytes,extra={})=>readVerifiedCommitMetadata(bytes,{oid:hash(bytes,extra.objectFormat),...extra});

test('frozen exact metadata, distinct identities, ordered parents and owned strings',()=>{
 const parents=['c'.repeat(40),'b'.repeat(40)],message='\ufeffTitle\r\n\tBody\r\nno final LF';
 const bytes=body(message,headers(parents)),result=read(bytes);
 assert.deepEqual(result,{oid:hash(bytes),tree:'a'.repeat(40),parents,author,committer,message,messageBytes:Buffer.byteLength(message)});
 for(const value of [result,result.author,result.committer,result.parents])assert.ok(Object.isFrozen(value));
 assert.throws(()=>{result.author.name='changed';},TypeError);
 assert.throws(()=>result.parents.push('x'),TypeError);
 bytes.fill(0);assert.equal(result.message,message);assert.deepEqual(result.author,author);
 assert.equal(typeof result.messageBytes,'number');
});

test('read-only messages preserve empty, blank, BOM, CRLF and all final-newline variants',()=>{
 for(const message of ['', ' \t\r\n', '\ufeff', '\ufeff中文\r\n', 'x', 'x\n', 'x\n\n', 'a\rb\tc', 'tree '+'b'.repeat(40)+'\n\nauthor forged']){
  const result=read(body(message));assert.equal(result.message,message);assert.equal(result.messageBytes,Buffer.byteLength(message));
 }
 assert.equal(read(body('x',[...headers(),'encoding UTF-8'])).message,'x');
});

test('message invalid UTF-8 and disallowed Unicode controls fail, never replace or strip',()=>{
 for(const message of [Buffer.from([0xff]),Buffer.from([0xc0,0x80]),Buffer.from([0xed,0xa0,0x80]),Buffer.from([0xe2,0x82])])assert.throws(()=>read(body(message)),/UTF-8/);
 for(const message of ['a\0b','a\x01b','\x1b[31m','\x7f','\u0085','\u009f'])assert.throws(()=>read(body(message)),/control/);
});

test('message and per-field UTF-8 byte bounds inclusive, body bound inherited',()=>{
 assert.equal(read(body('x'.repeat(65536))).messageBytes,65536);
 assert.equal(read(body('é'.repeat(32768))).messageBytes,65536);
 assert.throws(()=>read(body('é'.repeat(32768)+'x')),/message byte limit/);
 for(const role of ['author','committer'])for(const field of ['name','email']){
  const p={...(role==='author'?author:committer),[field]:'é'.repeat(512)};
  const lines=headers().map(line=>line.startsWith(role+' ')?role+' '+identity(p):line);
  assert.equal(read(body('',lines))[role][field],p[field]);
  p[field]+='x';assert.throws(()=>read(body('',headers().map(line=>line.startsWith(role+' ')?role+' '+identity(p):line))),/identity field byte limit/);
 }
 assert.throws(()=>readVerifiedCommitMetadata(Buffer.alloc(2*1024*1024+1),{}),/body byte limit/);
});

test('root through sixteen-parent reads supported, duplicates and malformed authenticated grammar rejected',()=>{
 for(const count of [0,1,2,16]){
  const parents=Array.from({length:count},(_,i)=>(i+1).toString(16).padStart(40,'0'));
  assert.deepEqual(read(body('',headers(parents))).parents,parents);
 }
 const h=headers(),parent='b'.repeat(40);
 const bad=[headers(Array(17).fill(0).map((_,i)=>(i+1).toString(16).padStart(40,'0'))),headers([parent,parent]),[h[0],h[0],...h.slice(1)],[h[0],h[1],h[1],h[2]],[...h,h[2]],[h[0],h[2],h[1]],[...h,'gpgsig signed',' continuation'],[...h,'mergetag tag'],[...h,'unknown value'],[...h,'encoding ISO-8859-1'],[...h,'encoding UTF-8','encoding UTF-8'],[h[0],h[1],'parent '+parent,h[2]]];
 for(const lines of bad)assert.throws(()=>read(body('',lines)));
 for(const bytes of [Buffer.from(h.join('\n')),Buffer.from(h.join('\r\n')+'\r\n\r\n')])assert.throws(()=>read(bytes));
});

test('identity exact timestamp and timezone retained; invalid identity remains rejected',()=>{
 for(const timezone of ['+0000','-0000','+1400','-1359']){
  const p={...author,timestamp:9007199254740991,timezone};
  assert.deepEqual(read(body('',[headers()[0],'author '+identity(p),headers()[2]])).author,p);
 }
 for(const value of ['N <e> 01 +0000','N <e> 9007199254740992 +0000','N <e> 0 +1460','N\tX <e> 0 +0000','N <e> -1 +0000'])assert.throws(()=>read(body('',[headers()[0],'author '+value,headers()[2]])));
 const raw=body('',[headers()[0],'author INVALID <e> 0 +0000',headers()[2]]);raw[raw.indexOf('INVALID')]=255;
 assert.throws(()=>read(raw),/UTF-8/);
});

test('authenticates exact body and rejects wrong OID, formats and input types',()=>{
 const bytes=body('original'),oid=hash(bytes);
 for(const bad of [undefined,null,0,'',oid.toUpperCase(),oid.slice(1),'0'.repeat(40),'b'.repeat(40)])assert.throws(()=>readVerifiedCommitMetadata(bytes,{oid:bad}));
 for(const changed of [bytes.subarray(0,bytes.length-1),Buffer.concat([bytes,Buffer.from('x')])])assert.throws(()=>readVerifiedCommitMetadata(changed,{oid}),/mismatch/);
 for(const objectFormat of ['SHA1','sha512',null])assert.throws(()=>readVerifiedCommitMetadata(bytes,{oid,objectFormat}),/format/);
 for(const bytes of [null,'raw',new Uint8Array(1)])assert.throws(()=>readVerifiedCommitMetadata(bytes,{}),/Buffer/);
});

test('strict own-data plain/null options reject extras, symbols and accessors without evaluation',()=>{
 const bytes=body(),oid=hash(bytes);let calls=0;
 assert.equal(readVerifiedCommitMetadata(bytes,Object.assign(Object.create(null),{oid})).oid,oid);
 for(const key of ['oid','objectFormat','signal','extra']){
  const options={};Object.defineProperty(options,key,{get(){calls++;throw Error('must not evaluate');}});
  assert.throws(()=>readVerifiedCommitMetadata(bytes,options));
 }
 for(const options of [null,1,[],new Date(),Object.create({oid}),{oid,extra:1},{oid,[Symbol('extra')]:1}])assert.throws(()=>readVerifiedCommitMetadata(bytes,options));
 assert.equal(calls,0);
});

test('snapshot precedes option traps and signal callbacks; mutations cannot change projection',()=>{
 for(const phase of ['getPrototypeOf','ownKeys','getOwnPropertyDescriptor','signal']){
  const bytes=body('original'),oid=hash(bytes),options={oid};
  const proxy=new Proxy(options,{getPrototypeOf(target){if(phase==='getPrototypeOf')bytes.fill(0);return Reflect.getPrototypeOf(target);},ownKeys(target){if(phase==='ownKeys')bytes.fill(0);return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){if(phase==='getOwnPropertyDescriptor')bytes.fill(0);return Reflect.getOwnPropertyDescriptor(target,key);}});
  if(phase==='signal')options.signal={get aborted(){bytes.fill(0);options.oid='b'.repeat(40);return false;}};
  const result=readVerifiedCommitMetadata(bytes,proxy);assert.equal(result.oid,oid);assert.equal(result.message,'original');assert.deepEqual(result.author,author);
 }
 const bytes=body('original'),oid=hash(bytes);bytes.copy=()=>{throw Error('caller method');};
 assert.equal(readVerifiedCommitMetadata(bytes,{oid}).message,'original');
});

test('cancellation before authentication, during verification and final metadata return',()=>{
 const controller=new AbortController();controller.abort();
 assert.throws(()=>read(body(),{signal:controller.signal}),{name:'AbortError'});
 // Count the supported synchronous callback boundaries without assuming parser internals.
 let total=0;read(body(),{signal:{get aborted(){total++;return false;}}});
 for(let stopAt=1;stopAt<=total;stopAt++){
  let checks=0;assert.throws(()=>read(body(),{signal:{get aborted(){return ++checks>=stopAt;}}}),{name:'AbortError'});
 }
});

for(const objectFormat of ['sha1','sha256'])test('real Git '+objectFormat+' commit-tree and cat-file metadata oracle',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dsh-commit-metadata-'));
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_AUTHOR_NAME:author.name,GIT_AUTHOR_EMAIL:author.email,GIT_AUTHOR_DATE:author.timestamp+' '+author.timezone,GIT_COMMITTER_NAME:committer.name,GIT_COMMITTER_EMAIL:committer.email,GIT_COMMITTER_DATE:committer.timestamp+' '+committer.timezone};
 const git=(args,input)=>execFileSync('git',['-C',dir,...args],{input,env,encoding:null,windowsHide:true});
 try{
  git(['init','--quiet','--object-format='+objectFormat]);
  const tree=git(['hash-object','-w','-t','tree','--stdin'],Buffer.alloc(0)).toString().trim();
  const parentIds=[];
  for(const message of ['', '\ufeffBOM\r\nbody\r\n', 'no final LF']){
   const args=['-c','commit.gpgSign=false','commit-tree',tree];
   for(const parent of parentIds)args.push('-p',parent);
   const oid=git(args,Buffer.from(message)).toString().trim(),raw=git(['cat-file','commit',oid]);
   assert.equal(hash(raw,objectFormat),oid);
   assert.equal(git(['hash-object','-t','commit','--stdin'],raw).toString().trim(),oid);
   const result=readVerifiedCommitMetadata(raw,{oid,objectFormat});
   assert.deepEqual(result,{oid,tree,parents:[...parentIds],author,committer,message,messageBytes:Buffer.byteLength(message)});
   parentIds.push(oid);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
