import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SUPPORTED_HOSTS,validateHostManifest} from '../scripts/host-compat-policy.mjs';

const readJson=async name=>JSON.parse(await readFile(new URL('../'+name,import.meta.url),'utf8'));
test('host support remains an exact allowlist and matches the lockfile',async()=>{
 const pkg=await readJson('package.json'),lock=await readJson('package-lock.json');
 assert.equal(pkg.peerDependencies['@deepseek-ai/dsh'],'0.1.7-rc.2 || 0.2.0-rc.2 || 0.2.1-rc.2 || 0.2.1-rc.5');
 assert.deepEqual(pkg.peerDependencies['@deepseek-ai/dsh'].split(' || '),SUPPORTED_HOSTS);
 assert.deepEqual(lock.packages[''].peerDependencies,pkg.peerDependencies);
 assert.deepEqual(lock.packages[''].peerDependenciesMeta,pkg.peerDependenciesMeta);
 assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh'].optional,true);
 assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);
 assert.equal(pkg.scripts['test:host-compat'],'node scripts/test-host-compat.mjs');
});
test('rc.5 is exact and every host preparation, contract and release matrix agrees',async()=>{
 assert.ok(SUPPORTED_HOSTS.includes('0.2.1-rc.5'));
 for(const version of ['0.2.1-rc.4','0.2.1-rc.6','0.2.1'])assert.throws(()=>validateHostManifest({name:'@deepseek-ai/dsh',version}));
 for(const workflow of ['host-fixtures','host-compat']){
  const source=await readFile(new URL('../.github/workflows/'+workflow+'.yml',import.meta.url),'utf8');
  const versions=source.match(/host: \[([^\]]+)\]/)?.[1].split(',').map(value=>value.trim().replaceAll("'",''));
  assert.deepEqual(versions,SUPPORTED_HOSTS,workflow+' matrix');
 }
 const release=await readFile(new URL('../.github/workflows/release.yml',import.meta.url),'utf8');
 assert.deepEqual(release.match(/for host in ([^;]+); do/)?.[1].split(' '),SUPPORTED_HOSTS);
});
