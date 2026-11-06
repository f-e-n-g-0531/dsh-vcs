import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {withOwnedIndexLock} from '../index-lock.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fixture(t){const temp=await mkdtemp(path.join(tmpdir(),'index-content-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),gitDirectory=path.join(root,'.git');await mkdir(gitDirectory);const index=path.join(gitDirectory,'index'),old=Buffer.from('old');await writeFile(index,old);return {index,lock:path.join(gitDirectory,'index.lock'),options:{gitDirectory,expectedIndexDigest:sha(old)}};}
test('candidate bytes are captured synchronously before caller mutation',async t=>{const f=await fixture(t);await withOwnedIndexLock(f.options,async lock=>{const bytes=Buffer.from('approved'),pending=lock.writeCandidate(bytes);bytes.fill(120);await pending;await lock.publish({assertAuthorized(){},beforePublish(){},onStart(){}});});assert.equal(await readFile(f.index,'utf8'),'approved');});
test('same-inode lock content tampering cannot publish an unapproved candidate',async t=>{const f=await fixture(t);await assert.rejects(withOwnedIndexLock(f.options,async lock=>{await lock.writeCandidate(Buffer.from('approved'));await writeFile(f.lock,'tampered');await lock.publish({assertAuthorized(){},beforePublish(){},onStart(){}});}));assert.equal(await readFile(f.index,'utf8'),'old');});
