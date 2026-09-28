import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {selectProject} from '../src/repositories.mjs';
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
