import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseGitIndex,replaceGitIndexEntry} from '../src/git-index.mjs';

const oldOid='a'.repeat(40),newOid='b'.repeat(40);
const tuple={path:'a',expectedOid:oldOid,expectedMode:'100644',oid:newOid,mode:'100755'};
function seal(body,format='sha1'){return Buffer.concat([body,createHash(format).update(body).digest()]);}
function fixture(paths=['a'],{version=2,format='sha1',extensions=[]}={}){
 const hashBytes=format==='sha1'?20:32,header=Buffer.alloc(12);header.write('DIRC');header.writeUInt32BE(version,4);header.writeUInt32BE(paths.length,8);
 const entries=paths.map(name=>{
  const bytes=Buffer.isBuffer(name)?name:Buffer.from(name),fixed=42+hashBytes,entry=Buffer.alloc(Math.ceil((fixed+bytes.length+1)/8)*8);
  for(let i=0;i<40;i++)entry[i]=i+1;
  entry.writeUInt32BE(0o100644,24);entry.fill(0xaa,40,40+hashBytes);entry.writeUInt16BE(Math.min(bytes.length,4095),40+hashBytes);bytes.copy(entry,fixed);return entry;
 });
 return seal(Buffer.concat([header,...entries,...extensions]),format);
}
function extension(signature,payload=Buffer.alloc(0),size=payload.length){const header=Buffer.alloc(8);header.write(signature,0,'latin1');header.writeUInt32BE(size,4);return Buffer.concat([header,payload]);}
function mutate(source,change,format='sha1'){const body=Buffer.from(source.subarray(0,source.length-(format==='sha1'?20:32)));change(body);return seal(body,format);}

test('parses exact UTF-8 paths, case distinctions, byte ordering and long-name sentinel',()=>{
 const paths=['A','a','nested/file','中文','\ufeffname'];
 const parsed=parseGitIndex(fixture(paths));
 assert.equal(parsed.version,2);assert.deepEqual(parsed.entries.map(entry=>entry.path),paths);
 assert.deepEqual(parsed.entries[0],{path:'A',oid:oldOid,mode:'100644',flags:1});
 assert.equal(parseGitIndex(fixture(['a'.repeat(4096)])).entries[0].flags,4095);
 assert.deepEqual(parseGitIndex(fixture([])).entries,[]);
 for(const names of [['a','a'],['z','a'],['中文','a']])assert.throws(()=>parseGitIndex(fixture(names)),/unique and byte ordered/);
});

test('rejects malformed headers, checksums, counts, truncation and resource bounds',()=>{
 const source=fixture();
 assert.throws(()=>parseGitIndex(new Uint8Array(source)),/Buffer/);
 assert.throws(()=>parseGitIndex(Buffer.alloc(0)),/Truncated/);
 assert.throws(()=>parseGitIndex(Buffer.alloc(8*1024*1024+1)),/byte limit/);
 assert.throws(()=>parseGitIndex(source,{objectFormat:'sha512'}),/object format/);
 const broken=Buffer.from(source);broken[20]^=1;assert.throws(()=>parseGitIndex(broken),/checksum/);
 assert.throws(()=>parseGitIndex(source.subarray(0,-1)),/checksum/);
 for(const count of [0,2,100000,100001,0xffffffff])assert.throws(()=>parseGitIndex(mutate(source,b=>b.writeUInt32BE(count,8))));
 for(const version of [0,1,4,0xffffffff])assert.throws(()=>parseGitIndex(mutate(source,b=>b.writeUInt32BE(version,4))),/version/);
 assert.throws(()=>parseGitIndex(mutate(source,b=>b[0]=0xc4)),/signature/);
 assert.throws(()=>parseGitIndex(seal(Buffer.from('DIRC'))),/Truncated/);
 assert.throws(()=>parseGitIndex(seal(source.subarray(0,75))),/Truncated/);
});

test('rejects unsupported modes, all stage and extended flags, invalid OIDs and padding',()=>{
 const source=fixture();
 for(const mode of [0o120000,0o160000,0o100664,0o040000,0])assert.throws(()=>parseGitIndex(mutate(source,b=>b.writeUInt32BE(mode,36))),/mode/);
 for(const flags of [0x8001,0x4001,0xc001,0x1001,0x2001,0x3001])assert.throws(()=>parseGitIndex(mutate(source,b=>b.writeUInt16BE(flags,72))),/flags|stage/);
 assert.throws(()=>parseGitIndex(mutate(source,b=>b.fill(0,52,72))),/object id/);
 assert.throws(()=>parseGitIndex(mutate(source,b=>b.writeUInt16BE(2,72))),/path length/);
 assert.throws(()=>parseGitIndex(mutate(fixture(['aa']),b=>b[77]=1)),/padding/);
 assert.throws(()=>parseGitIndex(mutate(source,b=>b.fill(0xff,75))),/NUL/);
 assert.throws(()=>parseGitIndex(fixture([Buffer.from([0xc0,0xaf])])),/UTF-8/);
 assert.throws(()=>parseGitIndex(fixture([Buffer.from([0xed,0xa0,0x80])])),/UTF-8/);
});

test('portable unsafe paths are rejected without case folding or normalization',()=>{
 for(const name of ['', '/a','../a','a/../b','a/./b','a//b','a/','a'+String.fromCharCode(92)+'b','C:a','a:stream','.git/a','a/.GiT/x','a'+String.fromCharCode(10)+'b','a'+String.fromCharCode(127)+'b','a.','a ','NUL','aux.txt','a/COM1.log','a?b'])assert.throws(()=>parseGitIndex(fixture([name])),undefined,name);
 assert.deepEqual(parseGitIndex(fixture(['auxiliary','com10.txt','e'+String.fromCharCode(769),'é'])).entries.map(entry=>entry.path),['auxiliary','com10.txt','e'+String.fromCharCode(769),'é']);
});

test('extension framing is bounded; mandatory and split indexes fail closed',()=>{
 for(const signature of ['link','sdir','abcd'])assert.throws(()=>parseGitIndex(fixture(['a'],{extensions:[extension(signature)]})),/mandatory/);
 for(const signature of ['1234','T'+String.fromCharCode(8)+'1E','AB!D'])assert.throws(()=>parseGitIndex(fixture(['a'],{extensions:[extension(signature)]})),/signature/);
 assert.throws(()=>parseGitIndex(fixture(['a'],{extensions:[Buffer.from('TREE')]})),/header/);
 assert.throws(()=>parseGitIndex(fixture(['a'],{extensions:[extension('TREE',Buffer.alloc(0),0xffffffff)]})),/payload/);
 const source=fixture(['a'],{extensions:[extension('TREE',Buffer.from('opaque')),extension('EOIE'),extension('IEOT')]});
 assert.deepEqual(parseGitIndex(source).extensions.map(({signature,size})=>({signature,size})),[{signature:'TREE',size:6},{signature:'EOIE',size:0},{signature:'IEOT',size:0}]);
 assert.deepEqual(parseGitIndex(replaceGitIndexEntry(source,tuple)).extensions,[]);
 for(const signature of ['FSMN','UNTR','REUC','ZZZZ']){
  const semantic=fixture(['a'],{extensions:[extension(signature)]});assert.equal(parseGitIndex(semantic).extensions[0].signature,signature);
  assert.throws(()=>replaceGitIndexEntry(semantic,tuple),/semantic/);
 }
});

test('candidate changes exactly the selected tuple and invalidates stat caches without changing unselected content',()=>{
 const source=fixture(['a','nested/b','z']),snapshot=Buffer.from(source),candidate=replaceGitIndexEntry(source,tuple);
 assert.deepEqual(source,snapshot);assert.equal(candidate.length,source.length);
 const before=parseGitIndex(source),after=parseGitIndex(candidate);
 assert.deepEqual(after.entries,[{...before.entries[0],oid:newOid,mode:'100755'},...before.entries.slice(1)]);
 for(const start of [76,148]){assert.deepEqual(candidate.subarray(start,start+24),Buffer.alloc(24));assert.deepEqual(candidate.subarray(start+28,start+40),Buffer.alloc(12));assert.deepEqual(candidate.subarray(start+40,start+64),source.subarray(start+40,start+64));}
 assert.deepEqual(candidate.subarray(12,36),Buffer.alloc(24));assert.deepEqual(candidate.subarray(40,52),Buffer.alloc(12));
 assert.deepEqual(candidate.subarray(74,76),source.subarray(74,76));
 assert.deepEqual(parseGitIndex(replaceGitIndexEntry(source,{...tuple,oid:oldOid,mode:'100644'})),parseGitIndex(source));
 for(const change of [{path:'missing'},{path:'A'},{expectedOid:newOid},{expectedMode:'100755'},{oid:'0'.repeat(40)},{oid:newOid.toUpperCase()},{mode:'120000'},{expectedMode:0o100644},{path:'../a'}])assert.throws(()=>replaceGitIndexEntry(source,{...tuple,...change}));
});

for(const objectFormat of ['sha1','sha256'])for(const version of [2,3])test('real Git accepts candidate: '+objectFormat+' v'+version,()=>{
 const cwd=mkdtempSync(path.join(tmpdir(),'vcs-git-index-'));
 const env={...process.env};for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_COMMON_DIR'])delete env[key];
 const git=(args,extra={})=>execFileSync('git',args,{cwd,env,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe'],...extra});
 try{
  git(['init','--object-format='+objectFormat]);git(['config','core.autocrlf','false']);git(['config','core.filemode','true']);
  mkdirSync(path.join(cwd,'nested'));writeFileSync(path.join(cwd,'a'),'original\n');writeFileSync(path.join(cwd,'nested','中文.txt'),'untouched\n');
  git(['add','--','a','nested/中文.txt']);git(['-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','-m','fixture']);
  git(['update-index','--index-version='+version]);
  // Git normally chooses v2 without extended flags; force an actual v3 header and
  // have Git independently validate it before using it as the parser's source.
  const liveIndex=path.join(cwd,'.git','index'),live=readFileSync(liveIndex),hashBytes=objectFormat==='sha1'?20:32;
  const source=mutate(live,b=>b.writeUInt32BE(version,4),objectFormat),sourceSnapshot=Buffer.from(source);
  const temporaryIndex=path.join(cwd,'.git','candidate-index');writeFileSync(temporaryIndex,source);
  const indexEnv={...env,GIT_INDEX_FILE:temporaryIndex};git(['ls-files','--stage','-z'],{env:indexEnv});
  const parsed=parseGitIndex(source,{objectFormat});assert.equal(parsed.version,version);assert.equal(parsed.entries.length,2);
  const selected=parsed.entries.find(entry=>entry.path==='a'),oid=git(['hash-object','-w','--stdin'],{input:'replacement\n'}).trim();
  const beforeStatus=git(['--no-optional-locks','status','--porcelain=v1']),beforeWork=['a','nested/中文.txt'].map(name=>readFileSync(path.join(cwd,name)));
  const candidate=replaceGitIndexEntry(source,{path:'a',expectedOid:selected.oid,expectedMode:selected.mode,oid,mode:'100755',objectFormat});
  assert.deepEqual(source,sourceSnapshot);assert.deepEqual(readFileSync(liveIndex),live);assert.equal(candidate.length<=source.length,true);
  writeFileSync(temporaryIndex,candidate);
  const listing=git(['-c','core.quotePath=false','ls-files','--stage','-z'],{env:indexEnv}).split('\0').filter(Boolean);
  assert.equal(listing[0],'100755 '+oid+' 0\ta');
  const other=parsed.entries.find(entry=>entry.path!=='a');assert.equal(listing[1],other.mode+' '+other.oid+' 0\t'+other.path);
  const tree=git(['write-tree'],{env:indexEnv}).trim();
  assert.equal(git(['ls-tree',tree,'--','a']).trim(),'100755 blob '+oid+'\ta');
  assert.ok(git(['diff-files','--name-only'],{env:indexEnv}).split('\n').includes('a'));
  assert.deepEqual(readFileSync(liveIndex),live);assert.equal(git(['--no-optional-locks','status','--porcelain=v1']),beforeStatus);
  assert.deepEqual(['a','nested/中文.txt'].map(name=>readFileSync(path.join(cwd,name))),beforeWork);
  assert.equal(parseGitIndex(candidate,{objectFormat}).entries[0].oid.length,hashBytes*2);
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
