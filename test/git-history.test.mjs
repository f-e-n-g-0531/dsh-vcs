import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {parseHistory,HISTORY_FORMAT,historyPage,historySearchArgs} from '../git-history.mjs';
const id='a'.repeat(40), date='2026-09-29T12:00:00+08:00', nul=String.fromCharCode(0);
const row=(parents='',subject='中文 <script>')=>[id,parents,'作者',date,subject].join(nul)+nul;
test('history search uses literal bounded values and rejects malformed paths',()=>{
 assert.deepEqual(historySearchArgs({message:'--all .*',author:'中文',path:':(glob)*.txt'}),{args:['--fixed-strings','--regexp-ignore-case','--grep=--all .*','--author=中文'],paths:[':(glob)*.txt']});
 for(const value of [null,[],{unknown:'x'},{message:12},{message:'x'.repeat(1025)},{author:'a\nb'},{path:'../x'},{path:'/x'},{path:'a//b'}])assert.throws(()=>historySearchArgs(value));
 assert.deepEqual(historySearchArgs(),{args:[],paths:[]});
});
test('history page distinguishes truncation from actual end',()=>{
 const rows=[{id:'one'},{id:'two'}];
 assert.deepEqual(historyPage(rows,'snapshot',10000,1),{snapshot:'snapshot',commits:[rows[0]],nextOffset:null,truncated:true});
 assert.equal(historyPage(rows,'snapshot',9999,1).nextOffset,10000);
 assert.equal(historyPage(rows,'snapshot',9999,1).truncated,false);
 assert.equal(historyPage([rows[0]],'snapshot',10000,1).truncated,false);
 assert.equal(historyPage([],'snapshot',0,50).nextOffset,null);
});
test('history parses root, merge parents and untrusted display text',()=>{
 const rows=parseHistory(row()+row(id+' '+id));
 assert.equal(rows.length,2);assert.deepEqual(rows[0].parents,[]);assert.equal(rows[1].parents.length,2);assert.equal(rows[0].subject,'中文 <script>');
 assert.deepEqual(parseHistory(''),[]);
 assert.equal(parseHistory(row().replace(date,'2026-09-29T04:00:00Z'))[0].date,'2026-09-29T04:00:00Z');
});
test('history rejects truncation, malformed IDs, dates and excessive output',()=>{
 assert.throws(()=>parseHistory(row().slice(0,-1)),/Truncated/);
 assert.throws(()=>parseHistory(row().replace(id,'--all')),/object id/);
 assert.throws(()=>parseHistory(row().replace(date,'invalid')),/timestamp/);
 assert.throws(()=>parseHistory(row()+row(),1),/limit/);
 assert.throws(()=>parseHistory('x'.repeat(2*1024*1024+1)),/limit/);
 assert.throws(()=>parseHistory('',0),/limit/);
});
test('history format parses a real temporary Git repository',()=>{
 const cwd=mkdtempSync(path.join(tmpdir(),'vcs-history-'));
 const git=args=>execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true});
 try{
 git(['init']);
 for(let i=0;i<3;i++)git(['-c','user.name=Test','-c','user.email=test@example.invalid','-c','commit.gpgsign=false','commit','--allow-empty','-m','Change '+i]);
 const rows=parseHistory(git(['--no-pager','log','-z','--no-show-signature','--max-count=3','--format='+HISTORY_FORMAT]),3);
 assert.equal(rows.length,3);assert.deepEqual(rows[2].parents,[]);assert.equal(rows[0].parents[0],rows[1].id);
 }finally{rmSync(cwd,{recursive:true,force:true});}
});
