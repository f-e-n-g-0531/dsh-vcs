import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReferences} from '../git-history.mjs';
const a='a'.repeat(40),b='b'.repeat(40);
const row=(name,type='commit',id=a,pt='',p='')=>[name,type,id,pt,p,''].join('\0')+'\n';
test('references distinguish branches lightweight and annotated commit tags',()=>{
 assert.deepEqual(parseReferences(row('refs/heads/主题')+row('refs/tags/light')+row('refs/tags/release','tag',a,'commit',b)),[
 {name:'refs/heads/主题',shortName:'主题',kind:'branch',commit:a},{name:'refs/tags/light',shortName:'light',kind:'tag',commit:a},{name:'refs/tags/release',shortName:'release',kind:'tag',commit:b}]);
 assert.deepEqual(parseReferences(row('refs/tags/blob','blob')+row('refs/tags/tree','tag',a,'tree',b)),[]);
 assert.equal(parseReferences(row('refs/heads/main','commit','c'.repeat(64)))[0].commit.length,64);
});
test('references reject framing invalid names duplicates OIDs and overflow',()=>{
 for(const input of [row('refs/heads/main').slice(0,-1),row('refs/remotes/origin/main'),row('refs/heads/a..b'),row('refs/heads/.hidden'),row('refs/heads/a.lock'),row('refs/heads/a b'),row('refs/heads/main')+row('refs/heads/main'),row('refs/heads/main','commit','bad'),row('refs/tags/tag','tag',a,'commit','b'.repeat(64)),row('refs/heads/main','commit',a,'commit',b),'x'.repeat(2*1024*1024+1)])assert.throws(()=>parseReferences(input));
 assert.equal(parseReferences(Array.from({length:1000},(_,i)=>row('refs/heads/b'+i)).join('')).length,1000);
 assert.throws(()=>parseReferences(Array.from({length:1001},(_,i)=>row('refs/heads/b'+i)).join('')),/count/);
 assert.deepEqual(parseReferences(''),[]);
});
