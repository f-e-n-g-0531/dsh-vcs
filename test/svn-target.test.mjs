import test from 'node:test';
import assert from 'node:assert/strict';
import {svnHistoryTarget} from '../src/svn-target.mjs';
test('SVN target encodes literal fspath components and pins numeric peg',()=>{
 assert.equal(svnHistoryTarget('https://example.test/repo','/中文 @ percent%#?.txt','42'),'https://example.test/repo/%E4%B8%AD%E6%96%87%20%40%20percent%25%23%3F.txt@42');
 assert.equal(svnHistoryTarget('https://example.test/repo/','/%2F/file','9007199254740993'),'https://example.test/repo/%252F/file@9007199254740993');
 assert.equal(svnHistoryTarget('https://example.test/','/','0'),'https://example.test/@0');
});
test('SVN target refuses unsafe or normalized roots and nonnumeric revisions',()=>{
 for(const root of ['file:///tmp/repo','http://example.test/repo','https://user:pass@example.test/repo','https://example.test/repo?q','https://example.test/repo#x','https://example.test/a/../b','https://example.test/%2e%2e/b','https://example.test/a%2fb','https://example.test/a//b','https://example.test/%zz'])assert.throws(()=>svnHistoryTarget(root,'/file','1'));
 for(const path of ['/../file','//file','/a/./b'])assert.throws(()=>svnHistoryTarget('https://example.test/repo',path,'1'));
 assert.throws(()=>svnHistoryTarget('https://example.test/repo','/file','HEAD'));
});
