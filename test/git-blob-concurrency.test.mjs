import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,realpath,readFile,lstat,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {inflateSync} from 'node:zlib';
import {storeCapturedBlob} from '../git-blob-store.mjs';
test('concurrent same-OID publishers never overwrite and leave one validated single-link object',async t=>{const temp=await mkdtemp(path.join(tmpdir(),'blob-concurrency-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),gitDirectory=path.join(root,'.git');await mkdir(path.join(gitDirectory,'objects'),{recursive:true});const bytes=Buffer.from('shared approved bytes');const options={gitDirectory,objectFormat:'sha1',bytes,assertAuthorized(){},onStart(){}};const outcomes=await Promise.allSettled(Array.from({length:8},()=>storeCapturedBlob(options)));for(const outcome of outcomes)if(outcome.status==='rejected')assert.equal(outcome.reason.code,'vcs/blob-outcome-unknown');const results=outcomes.filter(o=>o.status==='fulfilled').map(o=>o.value);assert.ok(results.length>=1);assert.ok(results.every(result=>result.oid===results[0].oid));const target=path.join(gitDirectory,'objects',results[0].oid.slice(0,2),results[0].oid.slice(2));assert.deepEqual(inflateSync(await readFile(target)),Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes]));assert.equal((await lstat(target)).nlink,1);assert.ok(!(await readdir(path.dirname(target))).some(n=>n.startsWith('.dsh-blob-')));});
