import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {storeCapturedObject} from '../git-object-store.mjs';
for(const objectFormat of ['sha1','sha256'])for(const type of ['tree','commit'])test('typed exact header and immutable captured bytes '+objectFormat+' '+type,async t=>{const temp=await mkdtemp(path.join(tmpdir(),'typed-golden-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),gitDirectory=path.join(root,'.git');await mkdir(path.join(gitDirectory,'objects'),{recursive:true});const bytes=Buffer.from('original payload\n'),expected=Buffer.concat([Buffer.from(type+' '+bytes.length+'\0'),bytes]),oid=createHash(objectFormat).update(expected).digest('hex');let started=0;const result=await storeCapturedObject({gitDirectory,objectFormat,type,bytes,assertAuthorized(){bytes.fill(0);},onStart(){started++;}});assert.equal(result.oid,oid);assert.equal(result.created,true);assert.equal(started,1);const file=path.join(gitDirectory,'objects',oid.slice(0,2),oid.slice(2)),compressed=await readFile(file);assert.deepEqual(inflateSync(compressed),expected);const again=await storeCapturedObject({gitDirectory,objectFormat,type,bytes:Buffer.from('original payload\n'),assertAuthorized(){},onStart(){}});assert.equal(again.created,false);assert.deepEqual(await readFile(file),compressed);});
