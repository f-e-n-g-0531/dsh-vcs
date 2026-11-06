import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {storeCapturedBlob} from '../git-blob-store.mjs';
async function fixture(t){const temp=await mkdtemp(path.join(tmpdir(),'blob-existing-'));t.after(()=>rm(temp,{recursive:true,force:true}));const root=await realpath(temp),gitDirectory=path.join(root,'.git');await mkdir(path.join(gitDirectory,'objects','info'),{recursive:true});const bytes=Buffer.from('approved'),raw=Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes]),oid=createHash('sha1').update(raw).digest('hex'),target=path.join(gitDirectory,'objects',oid.slice(0,2),oid.slice(2));await mkdir(path.dirname(target));return {gitDirectory,bytes,raw,target};}
for(const kind of ['trailing','second-stream','wrong-type','wrong-length','inflate-bomb'])test('existing loose object refuses '+kind+' without replacing bytes',async t=>{const f=await fixture(t);let raw=f.raw,zipped;if(kind==='wrong-type')raw=Buffer.concat([Buffer.from('tree 8\0'),f.bytes]);if(kind==='wrong-length')raw=Buffer.concat([Buffer.from('blob 9\0'),f.bytes]);if(kind==='inflate-bomb')raw=Buffer.alloc(2*1024*1024+100);zipped=deflateSync(raw);if(kind==='trailing')zipped=Buffer.concat([zipped,Buffer.from('junk')]);if(kind==='second-stream')zipped=Buffer.concat([zipped,deflateSync(Buffer.from('other'))]);await writeFile(f.target,zipped);let starts=0;await assert.rejects(storeCapturedBlob({...f,objectFormat:'sha1',assertAuthorized(){},onStart(){starts++;}}));assert.equal(starts,0);assert.deepEqual(await readFile(f.target),zipped);});
