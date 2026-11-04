import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoricalAccess} from '../src/historical-access.mjs';
const commit='a'.repeat(40),oid='b'.repeat(40);
function fixture(text) {
 const body=Buffer.from(text);let reads=0;
 const access=createHistoricalAccess({run:async(root,args)=>{
  if(args[0]==='ls-tree')return Buffer.from('100644 blob '+oid+'\tf\0');
  if(args[1]==='-t')return Buffer.from('commit');
  if(args[1]==='-s')return Buffer.from(String(body.length));
  reads++;return body;
 }});return {access,body,reads:()=>reads};
}
test('line seek uses fixed blob and returns true global line coordinates across UTF8 segments',async()=>{
 const {access,body,reads}=fixture('中文\r\n'.repeat(150000));
 try {const p=await access.segment('r',{commit,path:'f',line:100001});assert.equal(p.offset,Buffer.byteLength('中文\r\n')*100000);assert.equal(p.startLine,100001);assert.equal(p.startsMidLine,false);assert.equal(p.targetFound,true);assert.equal(p.endLine,p.startLine+p.text.split('\n').length-1);assert.ok(Buffer.byteLength(p.text)<=65536);assert.equal(p.oid,oid);
 const next=await access.segment('r',{commit,path:'f',offset:p.nextOffset});assert.equal(next.startLine,p.endLine);assert.equal(reads(),1);assert.equal(next.text,body.subarray(next.offset,next.endOffset).toString());
 } finally {access.clear();}
});
test('long line returns its real start and marks continuation; EOF and invalid target are explicit',async()=>{
 const {access}=fixture('first\n'+'中'.repeat(50000)+'\nlast\n');
 try {const p=await access.segment('r',{commit,path:'f',line:2});assert.equal(p.offset,6);assert.equal(p.startLine,2);assert.equal(p.lineTruncated,true);assert.equal(p.startsMidLine,false);
 const n=await access.segment('r',{commit,path:'f',offset:p.nextOffset});assert.equal(n.startLine,2);assert.equal(n.startsMidLine,true);
 const eof=await access.segment('r',{commit,path:'f',line:4});assert.equal(eof.targetFound,true);assert.equal(eof.text,'');assert.equal(eof.startLine,4);
 const missing=await access.segment('r',{commit,path:'f',line:5});assert.equal(missing.targetFound,false);assert.match(missing.notice,/exceeds/);assert.equal(missing.nextOffset,null);
 for(const options of [{line:0},{line:1,offset:0},{line:1.5},{line:Infinity}])await assert.rejects(access.segment('r',{commit,path:'f',...options}),/line/);
 }finally{access.clear();}
});
test('mixed CRLF CR LF and CRLF boundary provide consistent global coordinates',async()=>{
 const text='a\rb\r\nc\n'+'x'.repeat(65528)+'\r\nlast\rend';const {access}=fixture(text);
 try {for(const line of [1,2,3,4,5,6]){const p=await access.segment('r',{commit,path:'f',line});assert.equal(p.startLine,line);assert.equal(p.startsMidLine,false);assert.equal(p.endLine,p.startLine+p.text.split(/\r\n|\r|\n/).length-1);}
 const p=await access.segment('r',{commit,path:'f'});assert.equal(p.text.endsWith('\r'),false);assert.equal(p.lineTruncated,p.endsMidLine);const n=await access.segment('r',{commit,path:'f',offset:p.nextOffset});assert.equal(n.startLine,p.endLine);
 }finally{access.clear();}
});
test('dense newlines at maximum blob size keep line seek bounded and offset coordinates exact',async()=>{
 const {access}=fixture('\n'.repeat(16*1024*1024));
 try {const p=await access.segment('r',{commit,path:'f',line:16000000});assert.equal(p.offset,15999999);assert.equal(p.startLine,16000000);assert.equal(p.startsMidLine,false);assert.equal(p.endLine,p.startLine+p.text.length);assert.equal(access.stats().entries,1);}finally{access.clear();}
});
