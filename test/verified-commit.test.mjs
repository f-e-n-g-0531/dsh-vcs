import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseVerifiedCommit} from '../src/verified-commit.mjs';

const tree='a'.repeat(40),person='测试 Author <test@example.invalid> 1700000000 +0800';
const headers=(parents=[],t=tree)=>['tree '+t,...parents.map(p=>'parent '+p),'author '+person,'committer '+person];
const body=(lines=headers(),message=Buffer.from('message'))=>Buffer.concat([Buffer.from(lines.join('\n')+'\n\n'),message]);
const hash=(bytes,format='sha1')=>createHash(format).update(Buffer.from('commit '+bytes.length+'\0')).update(bytes).digest('hex');
const parse=(bytes,extra={})=>parseVerifiedCommit(bytes,{oid:hash(bytes,extra.objectFormat),...extra});
const reject=lines=>assert.throws(()=>parse(body(lines)));

test('returns only frozen oid/tree/parents preserving parent order',()=>{
 const parents=['c'.repeat(40),'b'.repeat(40)],bytes=body(headers(parents)),oid=hash(bytes);
 const result=parseVerifiedCommit(bytes,{oid});
 assert.deepEqual(result,{oid,tree,parents});
 assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.parents));
 assert.throws(()=>result.parents.push(tree),TypeError);
 assert.throws(()=>{result.tree='x';},TypeError);
 bytes.fill(0);assert.equal(result.tree,tree);
 assert.deepEqual(parse(body()).parents,[]);
});

test('snapshots bytes synchronously before signal callbacks can mutate input',()=>{
 const bytes=body(),oid=hash(bytes);
 const signal={get aborted(){bytes.fill(0);return false;}};
 assert.equal(parseVerifiedCommit(bytes,{oid,signal}).tree,tree);
});

test('validates exact full lowercase nonzero OID and supported formats',()=>{
 for(const objectFormat of ['sha1','sha256']){
  const width=objectFormat==='sha1'?40:64,bytes=body(headers([],'a'.repeat(width))),oid=hash(bytes,objectFormat);
  assert.equal(parseVerifiedCommit(bytes,{oid,objectFormat}).oid,oid);
  for(const bad of [undefined,null,0,Buffer.from(oid),'',oid.slice(1),oid+'a',oid.toUpperCase(),'0'.repeat(width),'g'.repeat(width),oid.slice(1)+'\n'])assert.throws(()=>parseVerifiedCommit(bytes,{oid:bad,objectFormat}));
  assert.throws(()=>parseVerifiedCommit(bytes,{oid:'1'.repeat(width),objectFormat}),/mismatch/);
  const truncated=bytes.subarray(0,bytes.length-1);
  assert.throws(()=>parseVerifiedCommit(truncated,{oid,objectFormat}),/mismatch/);
 }
 for(const objectFormat of ['SHA1','sha512',null])assert.throws(()=>parseVerifiedCommit(body(),{oid:tree,objectFormat}),/format/);
 for(const bytes of ['text',new Uint8Array(),null,undefined])assert.throws(()=>parseVerifiedCommit(bytes,{oid:tree}),/Buffer/);
 assert.throws(()=>parseVerifiedCommit(body()),/object id/);
});

test('requires first unique tree and ordered unique author/committer with blank separator',()=>{
 const h=headers();
 for(const lines of [[],h.slice(1),[h[1],h[0],h[2]],[h[0],h[0],...h.slice(1)],[...h,h[0]],[h[0],h[2],h[1]],[h[0],h[1],h[1],h[2]],[...h,h[2]],h.slice(0,2)])reject(lines);
 for(const bytes of [Buffer.from(h.join('\n')),Buffer.from(h.join('\n')+'\n'),Buffer.from(h.join('\r\n')+'\r\n\r\n')])assert.throws(()=>parse(bytes));
 for(const suffix of [' extra','\r','\0',' '])reject(['tree '+tree+suffix,...h.slice(1)]);
 for(const id of [tree.slice(1),'0'.repeat(40),tree.toUpperCase(),'a'.repeat(64)])reject(['tree '+id,...h.slice(1)]);
});

test('parents are contiguous before author, full-width, unique, maximum sixteen',()=>{
 const parents=Array.from({length:16},(_,i)=>(i+1).toString(16).padStart(40,'0'));
 assert.deepEqual(parse(body(headers(parents))).parents,parents);
 reject(headers([...parents,'f'.repeat(40)]));reject(headers([parents[0],parents[0]]));
 reject([headers()[0],headers()[1],'parent '+parents[0],headers()[2]]);
 reject([...headers(),'parent '+parents[0]]);
 reject(['parent '+parents[0],...headers()]);
 for(const p of ['0'.repeat(40),'A'.repeat(40),'a'.repeat(39),'a'.repeat(64),parents[0]+' x'])reject(headers([p]));
});

test('optional exact encoding UTF-8 only after committer; unknown/continued headers rejected',()=>{
 assert.equal(parse(body([...headers(),'encoding UTF-8'])).tree,tree);
 for(const line of ['encoding utf-8','encoding UTF8','encoding ISO-8859-1','encoding UTF-8 ','gpgsig signature','mergetag tag','extra value',' tree '+tree,'\tcontinued','tree','Tree '+tree,'author\t'+person])reject([...headers(),line]);
 reject([...headers(),'encoding UTF-8','encoding UTF-8']);
 reject([headers()[0],'encoding UTF-8',...headers().slice(1)]);
 reject([headers()[0],'gpgsig a',' continued',...headers().slice(1)]);
});

test('identity UTF-8, framing, NAME <EMAIL>, integer timestamp and timezone validated',()=>{
 const bad=['','plain',' <e> 0 +0000','N <> 0 +0000','N <e> -1 +0000','N <e> 01 +0000','N <e> 1.5 +0000','N <e> 9007199254740992 +0000','N <e> 0 +0060','N <e> 0 +1401','N <e> 0 +1500','N <e> 0 0000','N <e> 0 +0000 extra','N <e> <x> 0 +0000','N\tX <e> 0 +0000','N\0X <e> 0 +0000','N\rX <e> 0 +0000','N\u2028X <e> 0 +0000','N\u200bX <e> 0 +0000','N\ntree '+tree];
 for(const role of ['author','committer']){
  for(const value of bad)reject(headers().map(line=>line.startsWith(role+' ')?role+' '+value:line));
  const bytes=body(headers().map(line=>line.startsWith(role+' ')?role+' INVALID':line));
  bytes[bytes.indexOf('INVALID')]=0xff;assert.throws(()=>parse(bytes),/UTF-8/);
  for(const tz of ['+0000','-0000','+1359','-1400','+1400'])assert.doesNotThrow(()=>parse(body(headers().map(line=>line.startsWith(role+' ')?role+' N <e> 9007199254740991 '+tz:line))));
 }
});

test('message remains opaque with invalid UTF-8, NUL, CR and forged headers',()=>{
 for(const message of [Buffer.alloc(0),Buffer.from([0xff,0xc0,0x80,0,13,10]),Buffer.from('tree '+'b'.repeat(40)+'\nauthor forged\n\n')])assert.equal(parse(body(headers(),message)).tree,tree);
});

test('body and header byte limits are inclusive and excessive line counts fail closed',()=>{
 const empty=body(headers(),Buffer.alloc(0));
 assert.doesNotThrow(()=>parse(body(headers(),Buffer.alloc(2*1024*1024-empty.length))));
 assert.throws(()=>parse(body(headers(),Buffer.alloc(2*1024*1024-empty.length+1))),/body byte limit/);
 const prefix='author ',suffix=' <e> 0 +0000';
 const base=body([headers()[0],prefix+'N'+suffix,headers()[2]],Buffer.alloc(0));
 const atLimit=body([headers()[0],prefix+'N'.repeat(128*1024-base.length+1)+suffix,headers()[2]],Buffer.alloc(0));
 assert.equal(atLimit.length,128*1024);assert.doesNotThrow(()=>parse(atLimit));
 assert.throws(()=>parse(Buffer.concat([atLimit.subarray(0,atLimit.length-1),Buffer.from('x\n')])) ,/header byte limit/);
 assert.throws(()=>parse(body([...headers(),...Array(257).fill('unknown value')])));
 assert.throws(()=>parse(Buffer.alloc(128*1024,65)),/separator|header byte limit/);
});

test('cancellation before hash, after hash, during headers and before return',()=>{
 const controller=new AbortController();controller.abort();
 assert.throws(()=>parse(body(),{signal:controller.signal}),{name:'AbortError'});
 for(const stopAt of [2,3,4,7]){
  let checks=0;const signal={get aborted(){return ++checks>=stopAt;}};
  assert.throws(()=>parse(body(),{signal}),{name:'AbortError'});
 }
});

for(const objectFormat of ['sha1','sha256'])test('real temporary Git '+objectFormat+' raw commit hash and stored bytes oracle',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dsh-verified-commit-'));
 const git=(args,input)=>execFileSync('git',['-C',dir,...args],{input,encoding:null,windowsHide:true});
 try{
  git(['init','--quiet','--object-format='+objectFormat]);
  const treeId=git(['hash-object','-w','-t','tree','--stdin'],Buffer.alloc(0)).toString().trim();
  const root=body(headers([],treeId));
  const parent=git(['hash-object','-w','-t','commit','--stdin'],root).toString().trim();
  // Git hash-object's fsck rejects message NUL; that broader opaque-byte case
  // is covered above. Invalid UTF-8 and CR remain valid raw-object oracle input.
  const raw=body([...headers([parent],treeId),'encoding UTF-8'],Buffer.from([0xff,13,10]));
  const oid=git(['hash-object','-w','-t','commit','--stdin'],raw).toString().trim();
  assert.equal(hash(raw,objectFormat),oid);
  const stored=git(['cat-file','commit',oid]);assert.deepEqual(stored,raw);
  assert.deepEqual(parseVerifiedCommit(stored,{oid,objectFormat}),{oid,tree:treeId,parents:[parent]});
  assert.throws(()=>parseVerifiedCommit(Buffer.concat([stored,Buffer.from('x')]),{oid,objectFormat}),/mismatch/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
