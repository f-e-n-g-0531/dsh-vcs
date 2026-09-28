import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const {version}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
for(const [tag,ok] of [['v'+version,true],['v999.0.0',false],['main',false],['v01.2.3',false],['v1.2.3-rc.1',false]])test('release tag gate: '+tag,()=>{const r=spawnSync(process.execPath,['scripts/verify-tag.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,RELEASE_TAG:tag},encoding:'utf8'});assert.equal(r.status===0,ok,r.stderr);});
