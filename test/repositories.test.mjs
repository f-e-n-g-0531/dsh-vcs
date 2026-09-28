import test from 'node:test';
import assert from 'node:assert/strict';
import {changeKey,requestMode,repositoryLabel,groupChanges,changePosition,adjacentChange,treeDirectoryIds,countChangeStatuses,filterChanges,buildChangeTree,createStatusLimiter} from '../src/repositories.mjs';

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

test('change tree gives directories stable paths, counts, and sorted Unicode files',()=>{
 const tree=buildChangeTree([{id:'1',path:'src/z.txt'},{id:'2',path:'src/a/中文.txt'},{id:'3',path:'README.md'},{id:'4',path:'src/a/space name.txt'}]);
 assert.equal(tree.count,0);assert.deepEqual(tree.directories.map(d=>d.id),['src']);
 const src=tree.directories[0];assert.equal(src.count,3);assert.deepEqual(src.directories.map(d=>d.id),['src/a']);
 assert.deepEqual(src.files.map(f=>f.path),['src/z.txt']);
 assert.equal(src.directories[0].count,2);assert.deepEqual(src.directories[0].files.map(f=>f.path),['src/a/中文.txt','src/a/space name.txt']);
 assert.deepEqual(tree.files.map(f=>f.path),['README.md']);
});

test('status filtering combines review category and case-insensitive path search',()=>{
 const changes=[{path:'src/Alpha.js',status:'modified'},{path:'src/new.js',status:'added'},{path:'old.txt',status:'deleted'}];
 assert.deepEqual(filterChanges(changes,'SRC','all').map(c=>c.path),['src/Alpha.js','src/new.js']);
 assert.deepEqual(filterChanges(changes,'','added').map(c=>c.path),['src/new.js']);
 assert.deepEqual(filterChanges(changes,'new','added').map(c=>c.path),['src/new.js']);
 assert.deepEqual(filterChanges(changes,'new','deleted'),[]);
});

test('adjacent review navigation wraps only within visible changes',()=>{
 const changes=[{id:'a'},{id:'b'},{id:'c'}];
 assert.equal(adjacentChange(changes,'b','next').id,'c');assert.equal(adjacentChange(changes,'b','previous').id,'a');
 assert.equal(adjacentChange(changes,'c','next').id,'a');assert.equal(adjacentChange(changes,'a','previous').id,'c');
 assert.equal(adjacentChange([], 'a','next'),null);assert.equal(adjacentChange(changes,'missing','next').id,'a');
});

test('tree directory ids support bulk collapse while preserving nested stable paths',()=>{
 const tree=buildChangeTree([{path:'src/a/file.js'},{path:'src/b/file.js'},{path:'docs/readme.md'}]);
 assert.deepEqual(treeDirectoryIds(tree),['docs','src','src/a','src/b']);
});

test('status counts retain all categories for review filter badges',()=>{
 assert.deepEqual(countChangeStatuses([{status:'modified'},{status:'added'},{status:'modified'}]),{all:3,modified:2,added:1});
 assert.deepEqual(countChangeStatuses(),{all:0});
});

test('review position reports selection within the visible result set',()=>{
 const changes=[{id:'a'},{id:'b'},{id:'c'}];
 assert.deepEqual(changePosition(changes,'b'),{index:2,total:3});
 assert.deepEqual(changePosition(changes,'missing'),{index:0,total:3});
 assert.deepEqual(changePosition([], 'a'),{index:0,total:0});
});
