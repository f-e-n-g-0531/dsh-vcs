import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gitCommand} from './helpers/git-command.mjs';
import {detectRepository,searchRepositoryContent} from '../vcs.mjs';
import {createHandler} from '../index.mjs';
import {searchContentPage} from '../src/content-search.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
const snapshot='a'.repeat(40),oid='b'.repeat(40);
function fixture(files) {
 const calls=[];
 const run=async(root,args,max,{signal}={})=>{
  signal?.throwIfAborted();calls.push(args);
  if(args[0]==='ls-tree')return Buffer.from(files.map((f,i)=>'100644 blob '+String(i+1).padStart(40,'0')+'\t'+f.path+'\0').join(''));
  const file=files[Number(args[2])-1];
  if(args[1]==='-s')return Buffer.from(String(file.size??file.body.length));
  assert.ok(file.body.length<=max);return file.body;
 };
 return {run,calls};
}
test('stable pages pass both old 100-per-file and 500-total caps with no duplicates',async()=>{
 const {run}=fixture([{path:'literal[1]:中文\nfile',body:Buffer.from('needle\n'.repeat(731))}]);
 let cursor,all=[];do {const page=await searchContentPage(run,'root',{snapshot,query:'needle',cursor});assert.ok(page.matches.length<=100);all.push(...page.matches);cursor=page.nextCursor??undefined;if(!cursor){assert.equal(page.complete,true);assert.equal(page.reason,null);}}while(cursor);
 assert.equal(all.length,731);assert.deepEqual(all.map(x=>x.line),Array.from({length:731},(_,i)=>i+1));assert.equal(all[0].path,'literal[1]:中文\nfile');
});
test('cursor binds root snapshot query and rejects tampering; replay is stable',async()=>{
 const {run}=fixture([{path:'a',body:Buffer.from('hit\n'.repeat(110))}]);
 const first=await searchContentPage(run,'root',{snapshot,query:'hit'}),cursor=first.nextCursor;
 const options={snapshot,query:'hit',cursor};
 assert.deepEqual(await searchContentPage(run,'root',options),await searchContentPage(run,'root',options));
 for(const [root,opts] of [['else',options],['root',{...options,query:'other'}],['root',{...options,snapshot:oid}],['root',{...options,cursor:cursor+'x'}]])await assert.rejects(searchContentPage(run,root,opts),/cursor/);
});
test('response budget handles very long special paths without losing the deferred match',async()=>{
 const files=Array.from({length:100},(_,i)=>({path:'中文'.repeat(12000)+i,body:Buffer.from('needle中'.repeat(1000))}));
 const {run}=fixture(files);let cursor,all=[];
 do{const page=await searchContentPage(run,'root',{snapshot,query:'needle',cursor});assert.ok(Buffer.byteLength(JSON.stringify(page))<2*1024*1024);all.push(...page.matches);cursor=page.nextCursor??undefined;}while(cursor);
 assert.equal(all.length,100);assert.equal(new Set(all.map(x=>x.path)).size,100);assert.ok(all.every(x=>!x.text.endsWith('�')));
 const a=await searchContentPage(run,'root',{snapshot,query:'needle'});await assert.rejects(searchContentPage(run,'root',{snapshot,query:'needle',cursor:a.nextCursor.split('.')[0]+'.'+'中'.repeat(43)}),/cursor/);
});
test('scan budget permits empty continuation; skipped state survives terminal page',async()=>{
 const files=Array.from({length:65},(_,i)=>({path:'f'+i,body:Buffer.from('none')}));files[0].size=16777217;files[64].body=Buffer.from('needle');
 const {run}=fixture(files),a=await searchContentPage(run,'root',{snapshot,query:'needle'});
 assert.equal(a.matches.length,0);assert.equal(a.reason,'scan-budget');assert.ok(a.nextCursor);assert.equal(a.complete,false);
 const b=await searchContentPage(run,'root',{snapshot,query:'needle',cursor:a.nextCursor});assert.equal(b.matches[0].path,'f64');assert.equal(b.nextCursor,null);assert.equal(b.complete,false);assert.equal(b.reason,'unsupported-content');assert.ok(b.warnings.length);
});
test('real adapter continuation stays pinned after HEAD moves',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-content-pages-')),git=gitCommand(root);
 try {git('init','-q');git('config','user.name','T');git('config','user.email','t@example.test');await writeFile(path.join(root,'literal[1].txt'),'needle\n'.repeat(620));git('add','.');git('commit','-qm','base');const repo=await detectRepository(root),first=await searchRepositoryContent(repo,{query:'needle'});
 await writeFile(path.join(root,'literal[1].txt'),'changed');git('add','.');git('commit','-qm','later');let cursor=first.nextCursor,total=first.matches.length;while(cursor){const page=await searchRepositoryContent(repo,{commit:first.snapshot,query:'needle',cursor});total+=page.matches.length;cursor=page.nextCursor;}assert.equal(total,620);await assert.rejects(searchRepositoryContent(repo,{query:'needle',cursor:first.nextCursor}),/fixed commit/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('RPC continuation fields retain strict validation and per-page grants',async()=>{
 let clock=0,seen;const repo={id:'r',type:'git',root:'/r'},handler=createHandler({sessions:{get:()=>({header:{cwd:'/r'}})},sessionPersistence:{stat:async()=>undefined}},{discoverRepositories:async()=>({repositories:[repo],warnings:[]}),searchRepositoryContent:async(r,o)=>{seen=o;return {};},getHistoricalSegment:async(r,o)=>{seen=o;return {};}},4,{now:()=>clock});const base={sessionId:'s',repositoryId:'r',commit:snapshot};await handler('vcs/repositories',{sessionId:'s'});
 assert.equal((await handler('vcs/grep',{...base,query:'needle',cursor:'opaque',limit:10})).ok,true);assert.equal(seen.cursor,'opaque');assert.equal(seen.limit,10);
 for(const extra of [{limit:101},{cursor:null},{cursor:'x',commit:undefined}])assert.equal((await handler('vcs/grep',{...base,query:'needle',...extra})).error.code,'vcs/invalid-request');
 assert.equal((await handler('vcs/tree-segment',{...base,path:'f',line:8})).ok,true);assert.equal(seen.line,8);assert.equal(seen.offset,undefined);assert.equal((await handler('vcs/tree-segment',{...base,path:'f',line:8,offset:0})).error.code,'vcs/invalid-request');
 clock=300001;assert.equal((await handler('vcs/grep',{...base,query:'needle',cursor:'opaque'})).error.code,'vcs/rediscover-required');
});
test('search global line numbers align with CRLF CR LF target readers',async()=>{
 const {run}=fixture([{path:'a',body:Buffer.from('no\rneedle\r\nno\nneedle')}]);const page=await searchContentPage(run,'root',{snapshot,query:'needle'});assert.deepEqual(page.matches.map(x=>x.line),[2,4]);
});
test('CR-only many-line scan is linear and long-line loops observe aggregate deadline',async()=>{
 const body=Buffer.from('no\r'.repeat(1000000)+'needle'),{run}=fixture([{path:'cr-only',body}]);
 const original=body.indexOf;let lfScans=0;
 body.indexOf=function(value,...args){if(value===10)lfScans++;return original.call(this,value,...args);};
 const page=await withOperationBudget({timeoutMs:15000},()=>searchContentPage(run,'root',{snapshot,query:'needle'}));assert.equal(page.matches[0].line,1000001);assert.equal(page.complete,true);assert.equal(lfScans,0);
 const long=fixture([{path:'long',body:Buffer.alloc(16*1024*1024,120)}]);
 await assert.rejects(withOperationBudget({timeoutMs:1},()=>searchContentPage(long.run,'root',{snapshot,query:'absent'})),{code:'TIMEOUT'});
});
test('literal queries, bounded long-line text, binary exclusion, cancellation and aggregate deadline',async()=>{
 const {run}=fixture([{path:'a',body:Buffer.from('x'.repeat(10000)+'[.*]\n')},{path:'binary',body:Buffer.from('hit\0')}]);
 const p=await searchContentPage(run,'root',{snapshot,query:'[.*]'});assert.equal(p.matches.length,1);assert.equal(p.matches[0].textTruncated,true);assert.ok(Buffer.byteLength(p.matches[0].text)<=4096);
 const c=new AbortController();c.abort();await assert.rejects(searchContentPage(run,'root',{snapshot,query:'x',signal:c.signal}),{name:'AbortError'});
 await assert.rejects(withOperationBudget({timeoutMs:1},async()=>{await new Promise(r=>setTimeout(r,5));return searchContentPage(run,'root',{snapshot,query:'x'});}),{code:'TIMEOUT'});
});
