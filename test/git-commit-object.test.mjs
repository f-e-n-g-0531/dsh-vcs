import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {encodeGitTree,encodeGitCommit} from '../src/git-commit-object.mjs';

const oid='a'.repeat(40);
const person={name:'测试 Author',email:'test@example.invalid',timestamp:1700000000,timezone:'+0800'};
const commit=(extra={})=>({tree:oid,parents:[],author:{...person},committer:{...person},message:'message',...extra});
const entry=(name='file',mode='100644',objectId=oid)=>({name,mode,oid:objectId});

function treeNames(body,hashBytes=20){
 const result=[];
 let offset=0;
 while(offset<body.length){const space=body.indexOf(32,offset),nul=body.indexOf(0,space);result.push(body.toString('utf8',space+1,nul));offset=nul+1+hashBytes;}
 return result;
}

test('tree uses canonical directory-aware raw UTF-8 ordering and exact framing',()=>{
 const entries=[entry('foo','40000'),entry('foo0'),entry('foo.bar'),entry('é'),entry('e\u0301'),entry('中文'),entry('A'),entry('a')];
 const before=structuredClone(entries),encoded=encodeGitTree(entries);
 assert.deepEqual(treeNames(encoded.body),['A','a','e\u0301','foo.bar','foo','foo0','é','中文']);
 assert.deepEqual(entries,before);
 assert.ok(encoded.body.includes(Buffer.concat([Buffer.from('40000 foo\0'),Buffer.from(oid,'hex')])));
 assert.equal(encodeGitTree([]).oid,'4b825dc642cb6eb9a060e54bf8d69288fbee4904');
 assert.deepEqual(treeNames(encodeGitTree([entry('foo'),entry('foo.bar')]).body),['foo','foo.bar']);
 assert.deepEqual(treeNames(encodeGitTree([entry('a\\b'),entry('\ufeffname')]).body),['a\\b','\ufeffname']);
});

test('tree rejects invalid UTF-8, unsafe names, duplicates and unsupported modes',()=>{
 for(const name of ['', '.', '..', '.git', '.GiT', 'a/b', 'a\0b', '\ud800', Buffer.from([0xc0,0xaf]), Buffer.from([0xed,0xa0,0x80])])assert.throws(()=>encodeGitTree([entry(name)]));
 assert.throws(()=>encodeGitTree([entry('x'),entry(Buffer.from('x'),'40000')]),/Duplicate/);
 for(const mode of ['120000','160000','040000','100664',0o100644,undefined])assert.throws(()=>encodeGitTree([entry('x',mode===undefined?null:mode)]),/mode/);
 assert.equal(treeNames(encodeGitTree([entry('X'),entry('x'),entry('é'),entry('e\u0301')]).body).length,4);
 assert.throws(()=>encodeGitTree([null]));assert.throws(()=>encodeGitTree({}));
});

test('tree enforces bounded entries, names and total body bytes',()=>{
 assert.throws(()=>encodeGitTree(Array(100001)),/entry limit/);
 assert.doesNotThrow(()=>encodeGitTree([entry('x'.repeat(4096))]));
 for(const name of ['x'.repeat(4097),'é'.repeat(2049)])assert.throws(()=>encodeGitTree([entry(name)]),/byte limit/);
 assert.throws(()=>encodeGitTree(Array.from({length:2100},(_,i)=>entry(String(i).padStart(4,'0')+'x'.repeat(4092)))),/byte limit/);
});

test('commit preserves exact header ordering, parent ordering and message bytes',()=>{
 const parents=['b'.repeat(40),'c'.repeat(40)],message='正文\r\nno final newline';
 const encoded=encodeGitCommit(commit({parents,message}));
 assert.equal(encoded.body.toString(),[
  'tree '+oid,...parents.map(parent=>'parent '+parent),
  'author 测试 Author <test@example.invalid> 1700000000 +0800',
  'committer 测试 Author <test@example.invalid> 1700000000 +0800','','正文\r\nno final newline',
 ].join('\n'));
 assert.notEqual(encoded.oid,encodeGitCommit(commit({parents,message:message+'\n'})).oid);
 assert.ok(encodeGitCommit(commit({message:''})).body.toString().endsWith('\n\n'));
 assert.equal(encodeGitCommit(commit({parents:undefined})).oid,encodeGitCommit(commit()).oid);
});

test('all identity fields reject header injection, controls, malformed UTF-8 and bounds',()=>{
 for(const role of ['author','committer'])for(const field of ['name','email']){
  for(const value of ['', '   ', 'a\nb', 'a\rb','a\0b','a\tb','a<b','a>b','a\x7fb','a\u0085b','a\u2028b','a\u200bb','\udfff','x'.repeat(1025),'é'.repeat(513),Buffer.from('name')]){
   assert.throws(()=>encodeGitCommit(commit({[role]:{...person,[field]:value}})),undefined,role+'.'+field+': '+String(value));
  }
  assert.doesNotThrow(()=>encodeGitCommit(commit({[role]:{...person,[field]:'é'.repeat(512)}})));
 }
 for(const value of [undefined,null,{},'name'])assert.throws(()=>encodeGitCommit(commit({author:value})));
});

test('timestamps and timezones are strict with inclusive +/-1400 maximum',()=>{
 for(const timestamp of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',undefined])assert.throws(()=>encodeGitCommit(commit({author:{...person,timestamp}})),/timestamp/);
 for(const timezone of ['0800','+800','+08:00','+0060','+1401','-1460','+1500','+9999','Z','+0000\n',undefined])assert.throws(()=>encodeGitCommit(commit({committer:{...person,timezone}})),/timezone/);
 for(const timezone of ['+0000','-0000','+1359','-1400','+1400'])for(const timestamp of [0,Number.MAX_SAFE_INTEGER])assert.doesNotThrow(()=>encodeGitCommit(commit({author:{...person,timestamp,timezone}})));
});

test('full lowercase nonzero object IDs and unique bounded parents required',()=>{
 for(const objectFormat of ['sha1','sha256']){
  const width=objectFormat==='sha1'?40:64,good='a'.repeat(width),options={objectFormat};
  for(const bad of ['',good.slice(1),good+'a',good.slice(1)+'\n','0'.repeat(width),'A'.repeat(width),'g'.repeat(width),'['+'a'.repeat(width-1),null,Buffer.from(good)]){
   assert.throws(()=>encodeGitTree([entry('x','100644',bad)],options));
   assert.throws(()=>encodeGitCommit(commit({tree:bad}),options));
   assert.throws(()=>encodeGitCommit(commit({tree:good,parents:[bad]}),options));
  }
  const parents=Array.from({length:16},(_,i)=>(i+1).toString(16).padStart(width,'0'));
  assert.doesNotThrow(()=>encodeGitCommit(commit({tree:good,parents}),options));
  assert.throws(()=>encodeGitCommit(commit({tree:good,parents:[good,good]}),options),/Duplicate/);
  assert.throws(()=>encodeGitCommit(commit({tree:good,parents:[...parents,good]}),options),/16/);
 }
 for(const parents of [null,'',{},[undefined]])assert.throws(()=>encodeGitCommit(commit({parents})));
 for(const objectFormat of ['SHA1','sha512',null]){assert.throws(()=>encodeGitTree([],{objectFormat}));assert.throws(()=>encodeGitCommit(commit(),{objectFormat}));}
});

test('message UTF-8 and byte limits are strict and returned Buffers are independent',()=>{
 for(const message of [null,undefined,new Uint8Array([1]),'a\0b','\ud800',Buffer.from([0xff]),Buffer.from([0xef,0xbb]),'x'.repeat(65537),'é'.repeat(32769)])assert.throws(()=>encodeGitCommit(commit({message})));
 for(const message of ['x'.repeat(65536),'é'.repeat(32768),Buffer.alloc(65536,0x61),'\ufefftext'])assert.doesNotThrow(()=>encodeGitCommit(commit({message})));
 const name=Buffer.from('name'),message=Buffer.from('message');
 const tree=encodeGitTree([entry(name)]),again=encodeGitTree([entry(name)]),encoded=encodeGitCommit(commit({message})),commitAgain=encodeGitCommit(commit({message}));
 name.fill(0);message.fill(0);assert.deepEqual(tree.body,again.body);assert.deepEqual(encoded.body,commitAgain.body);
 tree.body.fill(0);encoded.body.fill(0);assert.notDeepEqual(tree.body,again.body);assert.notDeepEqual(encoded.body,commitAgain.body);
});

for(const objectFormat of ['sha1','sha256'])test('real Git stdin oracle and temp-only object round trips: '+objectFormat,()=>{
 const cwd=mkdtempSync(path.join(tmpdir(),'vcs-commit-object-'));
 const env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
 Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(cwd,'absent-global-config')});
 const git=(args,input,encoding='utf8')=>execFileSync('git',args,{cwd,env,input,encoding,windowsHide:true,maxBuffer:2*1024*1024});
 const options={objectFormat};
 const verify=(type,encoded)=>{
  assert.equal(git(['hash-object','-t',type,'--stdin'],encoded.body).trim(),encoded.oid);
  assert.equal(git(['hash-object','-w','-t',type,'--stdin'],encoded.body).trim(),encoded.oid);
  assert.deepEqual(git(['cat-file',type,encoded.oid],undefined,'buffer'),encoded.body);
 };
 try{
  git(['init','--object-format='+objectFormat]);
  const blob=git(['hash-object','-w','--stdin'],Buffer.from('blob content')).trim();
  const empty=encodeGitTree([],options);verify('tree',empty);
  const entries=[entry('foo','40000',empty.oid),entry('foo0','100755',blob),entry('foo.bar','100644',blob),entry('中文','100644',blob),entry('é','100644',blob),entry('e\u0301','100644',blob)];
  const tree=encodeGitTree(entries,options);verify('tree',tree);
  const mktree=Buffer.concat(entries.map(e=>Buffer.from(e.mode+' '+(e.mode==='40000'?'tree':'blob')+' '+e.oid+'\t'+e.name+'\0')));
  assert.equal(git(['mktree','-z'],mktree).trim(),tree.oid);
  const root=encodeGitCommit(commit({tree:tree.oid,message:'根提交 without final newline'}),options);verify('commit',root);
  const second=encodeGitCommit(commit({tree:tree.oid,parents:[root.oid],message:Buffer.from('message\n')}),options);verify('commit',second);
  const merge=encodeGitCommit(commit({tree:tree.oid,parents:[root.oid,second.oid],message:''}),options);verify('commit',merge);
  assert.equal(git(['cat-file','-t',merge.oid]).trim(),'commit');
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
