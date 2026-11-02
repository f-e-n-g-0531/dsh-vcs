import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {gitCommand} from './helpers/git-command.mjs';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createHistoricalAccess,parseTreeEntries,validateHistoricalPath,HISTORICAL_CACHE_LIMITS} from '../src/historical-access.mjs';
import {detectRepository,getHistoricalFile,getHistoricalSegment,getHistoricalTreePage,clearHistoricalCache,historicalCacheStats,searchRepositoryContent} from '../vcs.mjs';

const commit = 'a'.repeat(40), oid = 'b'.repeat(40), treeOid = 'c'.repeat(40);
const row = (file,mode = '100644',type = 'blob',id = oid) => Buffer.from(`${mode} ${type} ${id}\t${file}\0`);
function fixture({body = Buffer.from('中文line\n'.repeat(20000)),now,maxBytes,maxEntries,ttlMs,hook} = {}) {
  const calls = [];
  const run = async (root,args,max,options) => {
    options.signal?.throwIfAborted();calls.push({root,args,max});
    if(hook) {const value = await hook(root,args);if(value !== undefined) return value;}
    if(args[0] === 'cat-file' && args[1] === '-t') return Buffer.from('commit\n');
    if(args[0] === 'ls-tree') return row(args.at(-1));
    if(args[0] === 'cat-file' && args[1] === '-s') return Buffer.from(String(body.length));
    if(args[0] === 'cat-file' && args[1] === 'blob') return body;
    throw Error('Unexpected command '+JSON.stringify(args));
  };
  const access = createHistoricalAccess({run,...(now ? {now} : {}),...(maxBytes ? {maxBytes} : {}),...(maxEntries ? {maxEntries} : {}),...(ttlMs ? {ttlMs} : {})});
  return {access,calls,body};
}

test('segmented UTF8 makes one bounded blob read and decode, with live member checks on every hit',async()=>{
 const {access,calls,body} = fixture();
 try {let offset=0,text='';do {const part=await access.segment('/one',{commit,path:'中文 file.txt',offset});assert.ok(Buffer.byteLength(part.text)<=65536);text+=part.text;offset=part.nextOffset;}while(offset!==null);assert.equal(text,body.toString());const stats=access.stats();assert.equal(stats.blobReads,1);assert.equal(stats.blobReadBytes,body.length);assert.equal(stats.decodeCount,1);assert.ok(stats.cacheHits>1);assert.equal(calls.filter(c=>c.args[0]==='ls-tree').length,stats.cacheHits+1);assert.ok(calls.every(c=>!c.args.includes('-r')));await assert.rejects(access.segment('/one',{commit,path:'中文 file.txt',offset:1}),/UTF-8/);
 } finally {access.clear();}
});

test('cache isolates repositories, bounds bytes and count, and uses fixed non-sliding TTL',async()=>{
 let time=0;const {access}=fixture({body:Buffer.from('abc'),now:()=>time,maxBytes:6,maxEntries:2,ttlMs:50});
 try {await access.segment('/one',{commit,path:'x'});time=40;await access.segment('/one',{commit,path:'x'});assert.equal(access.stats().blobReads,1);time=51;await access.segment('/one',{commit,path:'x'});assert.equal(access.stats().blobReads,2);await access.segment('/two',{commit,path:'x'});assert.equal(access.stats().blobReads,3);await access.segment('/three',{commit,path:'x'});assert.equal(access.stats().entries,2);assert.equal(access.stats().bytes,6);access.clear('/two');assert.equal(access.stats().entries,1);assert.equal(access.stats().reservedBytes,0);
 } finally {access.clear();}
 assert.throws(()=>createHistoricalAccess({run:()=>{},maxBytes:HISTORICAL_CACHE_LIMITS.maxBytes+1}),/configuration/);
});

test('clear prevents an in-flight read from repopulating and reservations prevent concurrent budget bypass',async()=>{
 let release,entered;const began=new Promise(r=>entered=r);const wait=new Promise(r=>release=r);
 const {access}=fixture({body:Buffer.from('abcd'),maxBytes:4,maxEntries:1,hook:async(_root,args)=>{if(args[1]==='blob'){entered();await wait;}}});
 const pending=access.segment('/one',{commit,path:'x'});await began;assert.equal(access.stats().reservedBytes,4);access.clear();await assert.rejects(access.segment('/two',{commit,path:'x'}),{code:'vcs/busy'});release();await pending;assert.equal(access.stats().bytes,0);assert.equal(access.stats().entries,0);assert.equal(access.stats().reservedEntries,0);access.clear();
});

test('clear during commit or exact member lookup cannot repopulate old cache generation',async()=>{
 for(const stage of ['-t','ls-tree']) {
   let release,entered,blocked=false;const began=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
   const {access}=fixture({hook:async(_root,args)=>{if(!blocked&&(args[1]===stage||args[0]===stage)){blocked=true;entered();await wait;}}});
   const pending=access.segment('/one',{commit,path:'x'});await began;access.clear('/one');release();await pending;assert.equal(access.stats().entries,0);assert.equal(access.stats().bytes,0);access.clear();
 }
});

test('nested tree query matches current-directory names across pages, not ancestor prefix',async()=>{
 const rows=Buffer.concat(Array.from({length:102},(_,i)=>row(i===101?'find-me':'item-'+i)));
 const access=createHistoricalAccess({run:async(_root,args)=>args[0]==='cat-file'?Buffer.from('commit'):args.includes('--')?row('src','040000','tree',treeOid):rows});
 try {assert.equal((await access.treePage('/one',{commit,path:'src',query:'src'})).entries.length,0);const found=await access.treePage('/one',{commit,path:'src',query:'find-me'});assert.deepEqual(found.entries.map(row=>row.path),['src/find-me']);assert.equal(found.nextOffset,null);}finally{access.clear();}
});

test('directory sorting is tree-first across page boundaries before paging',async()=>{
 const rows=Buffer.concat([...Array.from({length:100},(_,i)=>row('a'+String(i).padStart(3,'0'))),row('zdir','040000','tree',treeOid)]);const access=createHistoricalAccess({run:async(_root,args)=>args[0]==='cat-file'?Buffer.from('commit'):rows});
 try {const page=await access.treePage('/one',{commit});assert.equal(page.entries[0].path,'zdir');assert.equal(page.nextOffset,100);assert.equal((await access.treePage('/one',{commit,offset:100})).entries[0].path,'a099');}finally{access.clear();}
});

test('failed blob read releases reservations and invalid UTF8 never enters cache',async()=>{
 let fail=true;const {access}=fixture({hook:async(_root,args)=>{if(args[1]==='blob'&&fail)throw Object.assign(Error('spawn failure'),{code:'VCS_COMMAND'});}});
 try {await assert.rejects(access.segment('/one',{commit,path:'x'}),{code:'VCS_COMMAND'});assert.equal(access.stats().reservedBytes,0);assert.equal(access.stats().entries,0);fail=false;await access.segment('/one',{commit,path:'x'});assert.equal(access.stats().entries,1);}finally{access.clear();}
 for(const body of [Buffer.from([0,1]),Buffer.from([0xff]),Buffer.alloc(16777217,97)]){const f=fixture({body});try{await assert.rejects(f.access.segment('/one',{commit,path:'x'}));assert.equal(f.access.stats().entries,0);assert.equal(f.access.stats().reservedBytes,0);}finally{f.access.clear();}}
});

test('cached content never replaces committed member checks or cancellation',async()=>{
 let present=true;const {access}=fixture({hook:async(_root,args)=>args[0]==='ls-tree'&&!present?Buffer.alloc(0):undefined});
 try {await access.segment('/one',{commit,path:'x'});present=false;await assert.rejects(access.segment('/one',{commit,path:'x'}),/regular file/);const c=new AbortController();c.abort();await assert.rejects(access.segment('/one',{commit,path:'x',signal:c.signal}),{name:'AbortError'});assert.equal(access.stats().blobReads,1);}finally{access.clear();}
});

test('directory pagination filters all 100000 direct entries before slicing and never recurses',async()=>{
 const rows=Buffer.concat(Array.from({length:100000},(_,i)=>row('file-'+String(i).padStart(6,'0'))));
 const commands=[];const access=createHistoricalAccess({run:async(_root,args)=>{commands.push(args);return args[0]==='cat-file'?Buffer.from('commit'):rows;}});
 try {const page=await access.treePage('/one',{commit,offset:99900});assert.equal(page.entries.length,100);assert.equal(page.entries[0].path,'file-099900');assert.equal(page.nextOffset,null);const result=await access.treePage('/one',{commit,query:'099999'});assert.deepEqual(result.entries.map(e=>e.path),['file-099999']);assert.equal(result.nextOffset,null);assert.ok(commands.every(args=>!args.includes('-r')));await assert.rejects(access.treePage('/one',{commit,query:'x\n'}),/query/);}finally{access.clear();}
});

test('nested tree uses exact path membership and a validated tree OID, not rev:path',async()=>{
 const commands=[];const access=createHistoricalAccess({run:async(_root,args)=>{commands.push(args);if(args[0]==='cat-file')return Buffer.from('commit');return args.includes('--')?row('dir:literal','040000','tree',treeOid):row('a.txt');}});
 try {const page=await access.treePage('/one',{commit,path:'dir:literal'});assert.equal(page.entries[0].path,'dir:literal/a.txt');assert.deepEqual(commands.at(-1),['ls-tree','-z',treeOid]);}finally{access.clear();}
 for(const invalid of ['','../x','a/../x','/x','a//b','a\0b'])assert.throws(()=>validateHistoricalPath(invalid),/path/);
 assert.throws(()=>parseTreeEntries(Buffer.from('100644 blob '+oid+'\tx')),/Truncated/);assert.throws(()=>parseTreeEntries(row('x','160000','blob')),/type/);assert.throws(()=>parseTreeEntries(Buffer.concat([row('x'),row('x')])),/Duplicate/);
});

test('real adapters provide fixed search snapshot, literal paths and reject stale repository before cached read',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vcs-historical-access-'));const g=gitCommand(root);
 try {g('init','-q');g('config','user.name','T');g('config','user.email','t@example.test');g('config','core.autocrlf','false');await writeFile(path.join(root,'literal[1].txt'),'needle 中文\n'.repeat(10000));await writeFile(path.join(root,'literal1.txt'),'other');g('add','.');g('commit','-qm','base');const snapshot=g('rev-parse','HEAD').trim(),repo=await detectRepository(root);const a=await getHistoricalFile(repo,{commit:snapshot,path:'literal[1].txt'});assert.match(a.text,/needle/);assert.equal((await getHistoricalTreePage(repo,{commit:snapshot,query:'literal['})).entries.length,1);assert.equal((await searchRepositoryContent(repo,{query:'absent'})).snapshot,snapshot);const found=await searchRepositoryContent(repo,{query:'other'});assert.equal(found.snapshot,snapshot);assert.equal(found.matches[0].path,'literal1.txt');
 const originalSpawn=childProcess.spawn;let cleared=false;childProcess.spawn=(command,args,options)=>{const child=originalSpawn(command,args,options);if(command==='git'&&args.includes('--show-toplevel')&&!cleared)child.stdout.once('data',()=>{cleared=true;clearHistoricalCache(root);});return child;};syncBuiltinESMExports();try{await getHistoricalSegment(repo,{commit:snapshot,path:'literal[1].txt'});assert.equal(cleared,true);assert.equal(historicalCacheStats().entries,0);}finally{childProcess.spawn=originalSpawn;syncBuiltinESMExports();}
 const before=historicalCacheStats();await getHistoricalSegment(repo,{commit:snapshot,path:'literal[1].txt'});await getHistoricalSegment(repo,{commit:snapshot,path:'literal[1].txt',offset:65536});assert.equal(historicalCacheStats().blobReads-before.blobReads,1);
 await rename(path.join(root,'.git'),path.join(root,'.git-hidden'));await assert.rejects(getHistoricalSegment(repo,{commit:snapshot,path:'literal[1].txt'}));
 }finally{clearHistoricalCache();await rm(root,{recursive:true,force:true,maxRetries:5});}
});
