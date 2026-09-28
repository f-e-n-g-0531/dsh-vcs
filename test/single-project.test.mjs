import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectProject,repositoryLabel} from '../src/repositories.mjs';
test('workspace Git and SVN entries remain distinct and remembered child wins',()=>{const repos=[{id:'child',type:'git',relativePath:'child'},{id:'git-root',type:'git',relativePath:'.'},{id:'svn-root',type:'svn',relativePath:'.'}];assert.equal(selectProject(repos),'git-root');assert.equal(selectProject(repos,'child'),'child');assert.equal(selectProject(repos,'svn-root'),'svn-root');assert.equal(selectProject(repos,'removed'),'git-root');assert.equal(repositoryLabel(repos[2],'工作区本身'),'SVN · 工作区本身');});
test('single project defaults to cwd then first; preserves selection on refresh',()=>{
 const repos=[{id:'child',relativePath:'child'},{id:'root',relativePath:'.'}];
 assert.equal(selectProject(repos),'root');assert.equal(selectProject(repos,'child'),'child');assert.equal(selectProject(repos,'removed'),'root');assert.equal(selectProject([repos[0]]),'child');assert.equal(selectProject([]),'');
});
test('client has only dropdown navigation and never falls back to all repositories',async()=>{
 const source=await readFile(new URL('../src/client.jsx',import.meta.url),'utf8');
 assert.ok(!source.includes('RepositoryNavigation'));
 assert.ok(!source.includes("t('allRepositories')"));
 assert.ok(source.includes('const visibleRepositories=repositories.filter(repo=>repo.id===repositoryId);'));
});
