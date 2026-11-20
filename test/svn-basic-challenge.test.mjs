import test from 'node:test';
import assert from 'node:assert/strict';
import {svnBasicCacheRealm} from '../src/svn-basic-challenge.mjs';

const origin='https://svn.example.test';
test('Basic checkout realms match Serf formatting and preserve exact realm case',()=>{
  assert.equal(svnBasicCacheRealm(origin,'Basic realm="Test, Repo"'),'<https://svn.example.test:443> Test, Repo');
  assert.equal(svnBasicCacheRealm(origin+':8443','basic realm="Repo", charset="UTF-8"'),'<https://svn.example.test:8443> Repo');
});
test('ambiguous challenges and non-canonical or untrusted origins are rejected',()=>{
  for(const input of [undefined,'','Basic','Digest realm="Repo"','Basic realm="A", Basic realm="B"','Basic realm="A", realm="B"','Basic realm="A\\B"','Basic realm="a\nb"','Basic realm="a"\r\n','Basic realm="中文"'])
    assert.equal(svnBasicCacheRealm(origin,input),undefined);
  for(const input of ['http://svn.example.test',origin+'/repo',origin+'/', 'https://user@svn.example.test','https://[::1]','https://svn.example.test:443'])
    assert.equal(svnBasicCacheRealm(input,'Basic realm="Repo"'),undefined);
});
