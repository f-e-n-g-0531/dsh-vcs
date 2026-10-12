import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {validateDateBound,historySearchArgs} from '../git-history.mjs';
import {detectRepository,listHistory} from '../vcs.mjs';
const g=(root,env,...args)=>execFileSync('git',['-C',root,...args],{env:{...process.env,...env},encoding:'utf8',windowsHide:true});
test('date bounds accept exact timestamps and reject free-form git date language',()=>{
 for(const ok of ['2020-01-01','2021-06-15','2021-06-15T10:30','2021-06-15 10:30:00','2021-06-15T10:30:00Z','2021-06-15T10:30:00+08:00','2021-06-15T10:30:00+0800'])assert.equal(validateDateBound(ok),ok);
 for(const bad of ['','2 weeks ago','yesterday','@1700000000','2021-13-01','2021-00-01','2021-06-00','2021-06-32','2021-02-29','2021-02-30','2021-02-31','2021-04-31','2021-06-31','2021-09-31','2021-11-31','0000-01-01','2021/06/15','-2021-06-15','2021-06-15; rm -rf','2021-06-15\n',' 2021-06-15','2021-06-15T25:00','2021-06-15T10:60','2021-06-15T10:30:00+24:00','x'.repeat(41)])assert.throws(()=>validateDateBound(bad));
 for(const ok of ['2024-02-29','2000-02-29','2024-12-31','2021-04-30'])assert.equal(validateDateBound(ok),ok);
});
test('history search args append as-filter flags without weakening other filters',()=>{
 const out=historySearchArgs({message:'fix',since:'2021-01-01',until:'2022-01-01'});precise(out.args);
 assert.deepEqual(out.args,['--fixed-strings','--regexp-ignore-case','--grep=fix','--since-as-filter=2021-01-01','--until=2022-01-01']);
 assert.deepEqual(out.paths,[]);
 assert.deepEqual(historySearchArgs({path:'src',since:'2020-01-01'}),{args:['--fixed-strings','--regexp-ignore-case','--since-as-filter=2020-01-01'],paths:['src']});
 assert.throws(()=>historySearchArgs({since:'2 weeks ago'}));assert.throws(()=>historySearchArgs({unknown:'x'}));
});
test('real history filters by committer date using as-filter semantics',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vcs-date-search-'));
 try{
  g(root,{},'init','-q');g(root,{},'config','user.name','T');g(root,{},'config','user.email','t@example.test');
  const commit=async(date,msg)=>{await writeFile(path.join(root,'f'),msg);g(root,{},'add','.');g(root,{GIT_COMMITTER_DATE:date},'commit','-q','--date',date,'-m',msg);};
  await commit('2020-01-01T00:00:00+00:00','one');await commit('2021-06-15T00:00:00+00:00','two');await commit('2022-01-01T00:00:00+00:00','three');await commit('2023-01-01T00:00:00+00:00','four');
  await new Promise(r=>setTimeout(r,20));
  const repo=await detectRepository(root);
  const all=await listHistory(repo);assert.deepEqual(all.commits.map(c=>c.subject),['four','three','two','one']);
  const mid=await listHistory(repo,{search:{since:'2021-01-01',until:'2022-12-31'}});assert.deepEqual(mid.commits.map(c=>c.subject),['three','two']);
  const after=await listHistory(repo,{search:{since:'2022-12-31'}});assert.deepEqual(after.commits.map(c=>c.subject),['four']);
  const before=await listHistory(repo,{search:{until:'2020-12-31'}});assert.deepEqual(before.commits.map(c=>c.subject),['one']);
 }finally{await rm(root,{recursive:true,force:true});}
});
function precise(){void 0;}
