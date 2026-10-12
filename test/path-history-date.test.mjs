import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {detectRepository,listPathHistory} from '../vcs.mjs';
const g=(root,env,...args)=>execFileSync('git',['-C',root,...args],{env:{...process.env,...env},encoding:'utf8',windowsHide:true});
test('path history filters by committer date and refuses date-range with rename follow',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'vcs-ph-date-'));
 try{
  g(root,{},'init','-q');g(root,{},'config','user.name','T');g(root,{},'config','user.email','t@example.test');
  const commit=async(date,msg)=>{await writeFile(path.join(root,'f'),msg);g(root,{},'add','.');g(root,{GIT_COMMITTER_DATE:date},'commit','-q','--date',date,'-m',msg);};
  await commit('2020-01-01T00:00:00+00:00','one');await commit('2021-06-15T00:00:00+00:00','two');await commit('2022-01-01T00:00:00+00:00','three');await commit('2023-01-01T00:00:00+00:00','four');
  await new Promise(r=>setTimeout(r,20));
  const repo=await detectRepository(root),head=g(root,{},'rev-parse','HEAD').trim();
  assert.deepEqual((await listPathHistory(repo,{commit:head,path:'f'})).commits.map(c=>c.subject),['four','three','two','one']);
  assert.deepEqual((await listPathHistory(repo,{commit:head,path:'f',since:'2021-01-01',until:'2022-12-31'})).commits.map(c=>c.subject),['three','two']);
  assert.deepEqual((await listPathHistory(repo,{commit:head,path:'f',since:'2022-12-31'})).commits.map(c=>c.subject),['four']);
  await assert.rejects(listPathHistory(repo,{commit:head,path:'f',since:'2021-01-01',follow:true}));
  await assert.rejects(listPathHistory(repo,{commit:head,path:'f',since:'2021-02-30'}));
  assert.equal(g(root,{},'status','--porcelain'),'');
 }finally{await rm(root,{recursive:true,force:true});}
});
