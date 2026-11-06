import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {buildIndexTree} from '../src/index-tree.mjs';
import {encodeGitTree} from '../src/git-commit-object.mjs';
import {parseGitIndex} from '../src/git-index.mjs';

const oid='a'.repeat(40);
const entry=(path,mode='100644',id=oid)=>({path,mode,oid:id});
function permutations(values){
 if(!values.length)return [[]];
 return values.flatMap((value,i)=>permutations(values.filter((_,j)=>i!==j)).map(rest=>[value,...rest]));
}

test('empty input produces one canonical root in both formats',()=>{
 for(const objectFormat of ['sha1','sha256']){
  const result=buildIndexTree([],{objectFormat}),empty=encodeGitTree([],{objectFormat});
  assert.deepEqual(result,{root:empty.oid,trees:[{path:'',...empty}]});
 }
 assert.equal(buildIndexTree([]).root,'4b825dc642cb6eb9a060e54bf8d69288fbee4904');
});

test('all input permutations have deterministic bottom-up trees and directory ordering',()=>{
 const entries=[entry('foo/z','100755'),entry('foo.bar'),entry('foo0'),entry('中文/é')];
 const expected=buildIndexTree(entries),snapshot=structuredClone(entries);
 const foo=encodeGitTree([{name:'z',mode:'100755',oid}]);
 const unicode=encodeGitTree([{name:'é',mode:'100644',oid}]);
 const root=encodeGitTree([{name:'foo',mode:'40000',oid:foo.oid},{name:'foo.bar',mode:'100644',oid},{name:'foo0',mode:'100644',oid},{name:'中文',mode:'40000',oid:unicode.oid}]);
 assert.deepEqual(expected,{root:root.oid,trees:[{path:'foo',...foo},{path:'中文',...unicode},{path:'',...root}]});
 for(const permutation of permutations(entries))assert.deepEqual(buildIndexTree(permutation),expected);
 assert.deepEqual(entries,snapshot);
 assert.ok(foo.body.includes(Buffer.from('100755 z\0')));
});

test('rejects malformed input, modes, formats and object IDs independently',()=>{
 for(const input of [null,undefined,{},Buffer.from('index'),new Set()])assert.throws(()=>buildIndexTree(input));
 for(const value of [null,undefined,1,'entry',{}])assert.throws(()=>buildIndexTree([value]));
 for(const objectFormat of ['SHA1','sha512',null,1])assert.throws(()=>buildIndexTree([],{objectFormat}),/format/);
 for(const mode of ['40000','040000','120000','160000','100664',0o100644,null,undefined])assert.throws(()=>buildIndexTree([{path:'file',mode,oid}]),/mode/);
 for(const objectFormat of ['sha1','sha256']){
  const width=objectFormat==='sha1'?40:64,valid='b'.repeat(width);
  for(const bad of ['',valid.slice(1),valid+'a','A'.repeat(width),'g'.repeat(width),'0'.repeat(width),valid.slice(1)+'\n',Buffer.from(valid),null,undefined]){
   assert.throws(()=>buildIndexTree([{path:'file',mode:'100644',oid:bad}],{objectFormat}),/object id/);
  }
  assert.doesNotThrow(()=>buildIndexTree([entry('file','100755',valid)],{objectFormat}));
 }
});

test('paths require safe relative strict UTF-8 strings, never Buffers',()=>{
 const paths=['','/file','//server/file','C:/file','C:file','a\\b','a:b','a//b','a/','.', '..','a/./b','a/../b','.git','.GiT/x','a/.GIT/x','a\0b','a\nb','a\rb','a\tb','a\x7fb','a\u0085b','a\u200bb','a\u2028b','a\u2029b','\ud800','a\udfff',Buffer.from('file'),new Uint8Array([97]),null,1];
 for(const value of paths)assert.throws(()=>buildIndexTree([entry(value)]),undefined,String(value));
 assert.doesNotThrow(()=>buildIndexTree([entry('目录/😀'),entry('other/é')]));
});

test('duplicates and file-directory prefixes reject in either insertion order',()=>{
 assert.throws(()=>buildIndexTree([entry('a'),entry('a','100755')]),/Duplicate/);
 for(const pair of [['a','a/b'],['a/b','a/b/c'],['a','a/b/c']]){
  for(const values of [pair,[...pair].reverse()])assert.throws(()=>buildIndexTree(values.map(value=>entry(value))),/prefix collision/);
 }
 assert.doesNotThrow(()=>buildIndexTree([entry('a/x'),entry('a/y'),entry('ab')]));
});

test('conservative sibling casefold and Unicode normalization collisions reject',()=>{
 for(const pair of [['A','a'],['A/x','a/y'],['A','a/b'],['é/x','e\u0301/y'],['SS','ß'],['Σ/x','ς/y']]){
  for(const values of [pair,[...pair].reverse()])assert.throws(()=>buildIndexTree(values.map(value=>entry(value))),/collision/);
 }
 // No global basename ban: independent directories may use different spellings.
 assert.doesNotThrow(()=>buildIndexTree([entry('one/A'),entry('two/a')]));
});

test('path byte and component-depth limits are inclusive',()=>{
 for(const name of ['x'.repeat(4096),'é'.repeat(2048)])assert.doesNotThrow(()=>buildIndexTree([entry(name)]));
 for(const name of ['x'.repeat(4097),'é'.repeat(2049)])assert.throws(()=>buildIndexTree([entry(name)]),/byte limit/);
 const deep=Array(64).fill('a').join('/');
 assert.equal(buildIndexTree([entry(deep)]).trees.length,64);
 assert.throws(()=>buildIndexTree([entry(deep+'/x')]),/depth limit/);
});

test('entry and total node bounds include the root and are independent',()=>{
 assert.throws(()=>buildIndexTree(Array(100001)),/entry limit/);
 const flat=Array.from({length:100000},(_,i)=>entry('f'+i));
 assert.equal(buildIndexTree(flat).trees.length,1);
 const nested=Array.from({length:50000},(_,i)=>entry('d'+i+'/f'));
 assert.equal(buildIndexTree(nested).trees.length,50001);
 assert.throws(()=>buildIndexTree([...nested,entry('extra')]),/node limit/);
});

test('aggregate body cap is inclusive and counts all directories and hash widths',()=>{
 const cap=8*1024*1024,fullSize=4096+28,count=Math.floor(cap/fullSize);
 const entries=Array.from({length:count},(_,i)=>entry(String(i).padStart(5,'0')+'x'.repeat(4091)));
 const remaining=cap-count*fullSize;
 assert.ok(remaining>28);
 entries.push(entry('z'.repeat(remaining-28)));
 const built=buildIndexTree(entries);
 assert.equal(built.trees.reduce((sum,tree)=>sum+tree.body.length,0),cap);
 assert.throws(()=>buildIndexTree([...entries,entry('extra')]),/aggregate tree byte limit/);
 assert.throws(()=>buildIndexTree(entries.map(value=>({...value,oid:'a'.repeat(64)})),{objectFormat:'sha256'}),/aggregate tree byte limit/);
 const nested=Array.from({length:2050},(_,i)=>entry('d'+i+'/'+'x'.repeat(4080)));
 assert.throws(()=>buildIndexTree(nested),/aggregate tree byte limit/);
});

test('results do not alias inputs, sibling bodies or subsequent results',()=>{
 const input=Object.freeze([Object.freeze(entry('one/file')),Object.freeze(entry('two/file'))]);
 const first=buildIndexTree(input),second=buildIndexTree(input);
 assert.deepEqual(first,second);
 assert.notStrictEqual(first.trees[0].body.buffer,first.trees[1].body.buffer);
 assert.notStrictEqual(first.trees[0].body.buffer,second.trees[0].body.buffer);
 const saved=Buffer.from(first.trees[1].body);
 first.trees[0].body.fill(0);
 assert.deepEqual(first.trees[1].body,saved);
 assert.notDeepEqual(first,second);
 assert.deepEqual(buildIndexTree(input),second);
});

for(const objectFormat of ['sha1','sha256'])test('real temp Git write-tree and every encoded tree oracle: '+objectFormat,()=>{
 const cwd=mkdtempSync(path.join(tmpdir(),'vcs-index-tree-'));
 const env={...process.env};
 for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
 Object.assign(env,{GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(cwd,'absent-global-config')});
 const git=(args,input,encoding='utf8')=>execFileSync('git',args,{cwd,env,input,encoding,windowsHide:true,maxBuffer:2*1024*1024});
 try{
  git(['init','--quiet','--object-format='+objectFormat]);
  git(['config','core.ignorecase','false']);
  git(['config','index.version','2']);
  const blob=git(['hash-object','-w','--stdin'],Buffer.from('test blob\n')).trim();
  const entries=[entry('foo/deep/脚本.sh','100755',blob),entry('foo.bar','100644',blob),entry('foo0','100755',blob),entry('目录/é.txt','100644',blob),entry('目录/😀/file','100755',blob),entry('other space/file name','100644',blob)];
  git(['update-index','-z','--index-info'],Buffer.concat(entries.map(value=>Buffer.from(value.mode+' '+value.oid+'\t'+value.path+'\0'))));
  const parsed=parseGitIndex(readFileSync(path.join(cwd,'.git','index')),{objectFormat});
  const result=buildIndexTree(parsed.entries,{objectFormat});
  assert.deepEqual(result,buildIndexTree([...entries].reverse(),{objectFormat}));
  assert.equal(git(['write-tree']).trim(),result.root);
  for(const tree of result.trees){
   assert.equal(git(['hash-object','-t','tree','--stdin'],tree.body).trim(),tree.oid);
   assert.deepEqual(git(['cat-file','tree',tree.oid],undefined,'buffer'),tree.body);
  }
  git(['read-tree','--empty']);
  assert.equal(git(['write-tree']).trim(),buildIndexTree([],{objectFormat}).root);
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
