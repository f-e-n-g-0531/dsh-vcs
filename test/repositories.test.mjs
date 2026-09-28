import test from 'node:test';
import assert from 'node:assert/strict';
import {changeKey,requestMode,repositoryLabel,groupChanges,createStatusLimiter} from '../src/repositories.mjs';

test('mixed repositories preserve distinct keys and SVN never receives staged mode',()=>{
 const git={id:'git',type:'git',relativePath:'client',branch:'main'},svn={id:'svn',type:'svn',relativePath:'assets'};
 assert.notEqual(changeKey(git.id,'same'),changeKey(svn.id,'same'));
 assert.notEqual(changeKey('a:b','c'),changeKey('a','b:c'));
 assert.equal(requestMode(git,'staged'),'staged');assert.equal(requestMode(svn,'staged'),'all');assert.equal(requestMode(svn,'unstaged'),'all');
 assert.equal(repositoryLabel(git),'GIT · client · main');
 const groups=groupChanges([git,svn],{git:{changes:[{id:'same',path:'Same.txt'}]},svn:{error:'unavailable'}},'same');
 assert.equal(groups[0].changes.length,1);assert.equal(groups[1].error,'unavailable');assert.deepEqual(groups[1].changes,[]);
});

test('status limiter never runs more than two and a repository error frees capacity',async()=>{
 const schedule=createStatusLimiter(2);let active=0,peak=0;const releases=[];
 const tasks=Array.from({length:5},(_,i)=>schedule(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>releases.push(resolve));active--;if(i===1)throw Error('one repo failed');return i;}).catch(e=>e.message));
 await new Promise(setImmediate);assert.equal(active,2);
 for(let i=0;i<5;i++){releases.shift()();await new Promise(setImmediate);}
 const results=await Promise.all(tasks);assert.equal(peak,2);assert.equal(results[1],'one repo failed');assert.equal(results[4],4);
});

test('queued cancelled status is never executed',async()=>{
 const schedule=createStatusLimiter(1);let release,called=false;const first=schedule(()=>new Promise(resolve=>{release=resolve;}));
 const controller=new AbortController();const next=schedule(()=>{called=true;},controller.signal);const rejected=assert.rejects(next,/Aborted/);controller.abort();await rejected;await new Promise(setImmediate);release();await first;assert.equal(called,false);
});
