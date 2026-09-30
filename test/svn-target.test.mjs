import test from 'node:test';
import assert from 'node:assert/strict';
import {svnHistoryTarget} from '../src/svn-target.mjs';
test('SVN target encodes literal fspath components and pins numeric peg',()=>{
 assert.equal(svnHistoryTarget('https://example.test/repo','/中文 @ percent%#?.txt','42'),'https://example.test/repo/%E4%B8%AD%E6%96%87%20%40%20percent%25%23%3F.txt@42');
 assert.equal(svnHistoryTarget('https://example.test/repo/','/%2F/file','9007199254740993'),'https://example.test/repo/%252F/file@9007199254740993');
 assert.equal(svnHistoryTarget('https://example.test/','/','0'),'https://example.test/@0');
});
test('SVN target bounds encoded output and preserves explicit authorities',()=>{
 const root='https://example.test/repo',prefix=root+'/';
 const length=32768-prefix.length-2;
 assert.equal(svnHistoryTarget(root,'/'+'x'.repeat(length),'1').length,32768);
 assert.throws(()=>svnHistoryTarget(root,'/'+'x'.repeat(length+1),'1'));
 assert.throws(()=>svnHistoryTarget(root,'/'+'中'.repeat(4000),'1'));
 assert.throws(()=>svnHistoryTarget(root,'/\ud800','1'));
 assert.equal(svnHistoryTarget('https://[::1]:8443/repo','/file','1'),'https://[::1]:8443/repo/file@1');
 assert.equal(svnHistoryTarget(root,'/','1'),root+'@1');
 assert.equal(svnHistoryTarget(root,'/!*()','1'),root+'/%21%2A%28%29@1');
});
test('SVN target refuses unsafe or normalized roots and nonnumeric revisions',()=>{
 for(const root of ['file:///tmp/repo','http://example.test/repo','https://user:pass@example.test/repo','https://example.test/repo?q','https://example.test/repo#x','https://example.test/a/../b','https://example.test/%2e%2e/b','https://example.test/a%2fb','https://example.test/a//b','https://example.test/%zz'])assert.throws(()=>svnHistoryTarget(root,'/file','1'));
 for(const path of ['/../file','//file','/a/./b'])assert.throws(()=>svnHistoryTarget('https://example.test/repo',path,'1'));
 assert.throws(()=>svnHistoryTarget('https://example.test/repo','/file','HEAD'));
});
