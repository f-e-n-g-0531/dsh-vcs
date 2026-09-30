import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {parseReferences} from '../git-history.mjs';
const a='a'.repeat(40),b='b'.repeat(40);
test('reference name validation agrees with Git for supported local namespaces',()=>{
 const valid=['main','主题/版本','feature/a-b_c','@','a@b','a.locked','a./b','release#1','x%y','x;y','x(y)','x{y}','x]y'];
 const invalid=['','/a','a/','a//b','.hidden','x/.hidden','a.lock','x/a.lock/y','a.','a..b','a@{b','a b','a~b','a^b','a:b','a?b','a*b','a[b','a'+String.fromCharCode(92)+'b','a'+String.fromCharCode(127)+'b',...Array.from({length:32},(_,i)=>'a'+String.fromCharCode(i)+'b')];
 for(const prefix of ['refs/heads/','refs/tags/'])for(const [names,expected] of [[valid,true],[invalid,false]])for(const short of names){
  const name=prefix+short;
  // NUL cannot be passed as a process argument, but must still be rejected by framing.
  if(!name.includes(String.fromCharCode(0))){
   const git=spawnSync('git',['check-ref-format',name],{encoding:'utf8',windowsHide:true,timeout:5000});
   assert.ifError(git.error);assert.ok(git.status===0||git.status===1,git.stderr);assert.equal(git.status===0,expected,JSON.stringify(name));
  }
  if(expected)assert.equal(parseReferences(row(name))[0].name,name);else assert.throws(()=>parseReferences(row(name)),undefined,JSON.stringify(name));
 }
});
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
