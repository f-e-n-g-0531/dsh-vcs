import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSvnPath,svnPathInScope,relativeSvnPath} from '../src/svn-path.mjs';
test('SVN scopes use path components rather than string prefixes',()=>{
 assert.equal(svnPathInScope('/trunk/file','/trunk'),true);assert.equal(svnPathInScope('/trunk','/trunk'),true);
 for(const path of ['/trunk-other/file','/trunks','/TRUNK/file','/branches/trunk'])assert.equal(svnPathInScope(path,'/trunk'),false);
 assert.equal(relativeSvnPath('/trunk/中文 @ %.txt','/trunk'),'中文 @ %.txt');assert.equal(relativeSvnPath('/trunk','/trunk'),'');assert.equal(relativeSvnPath('/trunk','/'),'trunk');assert.equal(relativeSvnPath('/','/'),'');
 assert.throws(()=>relativeSvnPath('/private','/trunk'));
});
test('SVN fspaths preserve literal escapes and reject ambiguous or unsafe input',()=>{
 for(const path of ['/', '/trunk/%2F','/trunk/%2e%2e','/trunk/ a ','/trunk/a:b'])assert.equal(validateSvnPath(path),path);
 assert.equal(relativeSvnPath('/trunk/%2F','/trunk'),'%2F');assert.equal(svnPathInScope('/trunk%2Fprivate','/trunk'),false);
 for(const path of [null,12,'','relative','https://server/repo','//server/path','/trunk/','/trunk//file','/trunk/../private','/./trunk','/trunk\\file','/trunk/\0','/trunk/\n','/'+ 'a'.repeat(32768)])assert.throws(()=>validateSvnPath(path));
 assert.throws(()=>svnPathInScope('/trunk','/trunk/'));assert.equal(validateSvnPath('/'+'a'.repeat(32767)).length,32768);
});
