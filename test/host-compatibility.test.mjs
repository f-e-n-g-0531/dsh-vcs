import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const readJson=async name=>JSON.parse(await readFile(new URL('../'+name,import.meta.url),'utf8'));
test('host support remains an exact allowlist and matches the lockfile',async()=>{
 const pkg=await readJson('package.json'),lock=await readJson('package-lock.json');
 assert.equal(pkg.peerDependencies['@deepseek-ai/dsh'],'0.1.7-rc.2 || 0.2.0-rc.2 || 0.2.1-rc.2');
 assert.deepEqual(lock.packages[''].peerDependencies,pkg.peerDependencies);
 assert.deepEqual(lock.packages[''].peerDependenciesMeta,pkg.peerDependenciesMeta);
 assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh'].optional,true);
 assert.equal(lock.version,pkg.version);assert.equal(lock.packages[''].version,pkg.version);
 assert.equal(pkg.scripts['test:host-compat'],'node scripts/test-host-compat.mjs');
});
