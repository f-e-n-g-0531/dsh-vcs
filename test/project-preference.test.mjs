import test from 'node:test';
import assert from 'node:assert/strict';
import {readProject,saveProject} from '../src/project-preference.mjs';
import {selectProject} from '../src/repositories.mjs';
test('project choice survives remount and stays isolated by workspace',()=>{const values=new Map();const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};saveProject('/one','repo-b',storage);saveProject('/two','repo-c',storage);assert.equal(readProject('/one',storage),'repo-b');assert.equal(readProject('/two',storage),'repo-c');assert.equal(readProject('/new',storage),'');assert.equal(selectProject([{id:'repo-a'},{id:'repo-b'}],readProject('/one',storage)),'repo-b');assert.equal(selectProject([{id:'repo-a'}],readProject('/one',storage)),'repo-a');});
test('blocked browser storage never breaks panel rendering',()=>{const storage={getItem(){throw Error('denied');},setItem(){throw Error('quota');}};assert.equal(readProject('/one',storage),'');assert.doesNotThrow(()=>saveProject('/one','repo',storage));});
