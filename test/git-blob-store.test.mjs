import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, realpath, readFile, writeFile, rm, lstat, readdir, link, symlink, rename, unlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash, randomBytes} from 'node:crypto';
import {deflateSync, inflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {storeCapturedBlob, MAX_BLOB_BYTES} from '../git-blob-store.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';

const code = value => e => e.code === value;
const unknown = e => e.code === 'vcs/blob-outcome-unknown' && e.appendOnly === true && e.outcomeUnknown === true;
const raw = b => Buffer.concat([Buffer.from('blob ' + b.length + '\0'),b]);
const oidFor = (b,format='sha1') => createHash(format).update(raw(b)).digest('hex');
async function fixture(t,format='sha1',git=false) {
  const dir=await mkdtemp(path.join(tmpdir(),'dsh-blob-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const root=await realpath(dir), gitDirectory=path.join(root,'.git');
  const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'no-global-config')};
  if(git)execFileSync('git',['init','-q','--object-format='+format,root],{env,stdio:'pipe'});
  else {await mkdir(gitDirectory);await mkdir(path.join(gitDirectory,'objects'));await mkdir(path.join(gitDirectory,'objects','info'));}
  const bytes=Buffer.from('captured\0bytes\r\n\xff','latin1');
  const options={gitDirectory,objectFormat:format,bytes,assertAuthorized(){},onStart(){}};
  const target=path.join(gitDirectory,'objects',oidFor(bytes,format).slice(0,2),oidFor(bytes,format).slice(2));
  return {root,env,gitDirectory,options,bytes,target,fanout:path.dirname(target),store:extra=>storeCapturedBlob({...options,...extra})};
}
async function seed(f,content) {await mkdir(f.fanout,{recursive:true});await writeFile(f.target,content);}
async function noTemps(f) {assert.ok(!(await readdir(f.fanout)).some(x=>x.startsWith('.dsh-blob-')));}
async function absent(p){await assert.rejects(lstat(p),code('ENOENT'));}
async function optionalLink(t,fn){try{await fn();return true;}catch(e){if(['EPERM','EACCES','ENOTSUP'].includes(e.code)){t.skip('OS link unavailable: '+e.code);return false;}throw e;}}

for(const format of ['sha1','sha256'])test('real Git cat-file reads empty, binary and raw '+format+' blobs',async t=>{
  const f=await fixture(t,format,true);
  const config=await readFile(path.join(f.gitDirectory,'config'));
  for(const bytes of [Buffer.alloc(0),Buffer.from([0,255,128,13,10,0]),Buffer.from('raw\r\nno conversion\n')]) {
    let starts=0;
    const result=await f.store({bytes,onStart(){starts++;}});
    assert.deepEqual(result,{oid:oidFor(bytes,format),created:true});assert.equal(starts,1);
    const output=execFileSync('git',['-C',f.root,'cat-file','blob',result.oid],{env:f.env,stdio:'pipe'});
    assert.deepEqual(output,bytes);
    const target=path.join(f.gitDirectory,'objects',result.oid.slice(0,2),result.oid.slice(2));
    assert.deepEqual(inflateSync(await readFile(target)),raw(bytes));assert.equal((await lstat(target)).nlink,1);
  }
  assert.deepEqual(await readFile(path.join(f.gitDirectory,'config')),config);
  await absent(path.join(f.gitDirectory,'index'));
});

test('repeat validates without overwrite or onStart',async t=>{
  const f=await fixture(t);await f.store();const before=await lstat(f.target,{bigint:true}),bytes=await readFile(f.target);
  assert.deepEqual(await f.store({onStart(){assert.fail('existing object is read-only');}}),{oid:oidFor(f.bytes),created:false});
  const after=await lstat(f.target,{bigint:true});assert.equal(before.ino,after.ino);assert.equal(before.mtimeNs,after.mtimeNs);assert.deepEqual(await readFile(f.target),bytes);await noTemps(f);
});

test('capture is synchronous before authorization await and caller mutation',async t=>{
  const f=await fixture(t);const captured=Buffer.from(f.bytes);let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const pending=f.store({assertAuthorized:()=>gate});f.bytes.fill(9);release();
  const result=await pending;assert.equal(result.oid,oidFor(captured));assert.deepEqual(inflateSync(await readFile(f.target)),raw(captured));
});

for(const kind of ['junk','wrong raw','wrong header','inflate bomb','trailing garbage','oversize compressed'])test('reject corrupt existing '+kind+' without replacement',async t=>{
  const f=await fixture(t);
  const data=kind==='junk'?Buffer.from('not zlib'):kind==='wrong raw'?deflateSync(raw(Buffer.from('foreign'))):kind==='wrong header'?deflateSync(Buffer.concat([Buffer.from('tree '+f.bytes.length+'\0'),f.bytes])):kind==='inflate bomb'?deflateSync(Buffer.alloc(MAX_BLOB_BYTES+100)):kind==='trailing garbage'?Buffer.concat([deflateSync(raw(f.bytes)),Buffer.from('junk')]):Buffer.alloc(MAX_BLOB_BYTES+65537);
  await seed(f,data);const before=await lstat(f.target,{bigint:true});
  await assert.rejects(f.store({onStart(){assert.fail('corruption must fail before start');}}),code('vcs/blob-corrupt'));
  assert.deepEqual(await readFile(f.target),data);assert.equal((await lstat(f.target,{bigint:true})).ino,before.ino);
});

test('2MiB exact boundary accepted, oversize/non-Buffer/format rejected before start',async t=>{
  const f=await fixture(t);const bytes=randomBytes(MAX_BLOB_BYTES);
  const result=await f.store({bytes});assert.equal(result.oid,oidFor(bytes));
  for(const bytes of [Buffer.alloc(MAX_BLOB_BYTES+1),new Uint8Array(1),'string',undefined])await assert.rejects(f.store({bytes,onStart(){assert.fail('start');}}));
  for(const objectFormat of ['SHA1','sha-1','sha512','sha256\n',null])await assert.rejects(f.store({objectFormat}),code('vcs/blob-invalid'));
  for(const hooks of [{onStart:null},{assertAuthorized:null}])await assert.rejects(f.store(hooks),code('vcs/blob-invalid'));
});

test('preabort, denied authorization and ambient abort leave objects unchanged',async t=>{
  const f=await fixture(t),c=new AbortController();c.abort();let starts=0;
  await assert.rejects(f.store({signal:c.signal,onStart(){starts++;}}),{name:'AbortError'});
  const denied=Error('denied');await assert.rejects(f.store({assertAuthorized(){throw denied;},onStart(){starts++;}}),e=>e===denied);
  await assert.rejects(withOperationBudget({signal:c.signal},()=>f.store()),{name:'AbortError'});
  await absent(f.fanout);assert.equal(starts,0);
});

test('ambient deadline before start is checked after awaited authorization',async t=>{
  const f=await fixture(t);let starts=0;
  await assert.rejects(withOperationBudget({timeoutMs:5},()=>f.store({assertAuthorized:()=>new Promise(r=>setTimeout(r,25)),onStart(){starts++;}})),code('TIMEOUT'));
  assert.equal(starts,0);await absent(f.fanout);
});

test('onStart precedes fanout creation; start failures/abort become append-only unknown',async t=>{
  const f=await fixture(t),c=new AbortController();
  await assert.rejects(f.store({onStart(){assert.equal(existsSync(f.fanout),false);throw Error('notify failed');}}),unknown);await absent(f.fanout);
  await assert.rejects(f.store({signal:c.signal,onStart(){c.abort();}}),unknown);await absent(f.fanout);
  await assert.rejects(f.store({onStart:async()=>{throw Error('async callback');}}),unknown);await absent(f.fanout);
});

for(const kind of ['abort','revoke','deadline'])test('poststart '+kind+' failure cleans owned temp only',async t=>{
  const f=await fixture(t),c=new AbortController();await mkdir(f.fanout);const foreign=path.join(f.fanout,'.dsh-blob-foreign');await writeFile(foreign,'foreign');let started=false,sawTemp=false;
  const operation=()=>f.store({signal:c.signal,onStart(){started=true;},async assertAuthorized(){
    if(!started)return;
    sawTemp=(await readdir(f.fanout)).some(x=>x.startsWith('.dsh-blob-')&&x!=='.dsh-blob-foreign');
    if(kind==='abort')c.abort();else if(kind==='revoke')throw Error('revoked');else throw Object.assign(Error('Injected post-temp deadline'),{code:'TIMEOUT'});
  }});
  await assert.rejects(kind==='deadline'?withOperationBudget({},operation):operation(),unknown);
  assert.equal(sawTemp,true);assert.deepEqual(await readdir(f.fanout),['.dsh-blob-foreign']);assert.equal(await readFile(foreign,'utf8'),'foreign');await absent(f.target);
});

test('authorization after publication fails unknown and never deletes final',async t=>{
  const f=await fixture(t);let calls=0;
  await assert.rejects(f.store({assertAuthorized(){if(++calls===4)throw Error('revoked after publication');}}),unknown);
  assert.deepEqual(inflateSync(await readFile(f.target)),raw(f.bytes));assert.equal((await lstat(f.target)).nlink,1);await noTemps(f);
});

for(const corrupt of [false,true])test('EEXIST publication race validates winner '+(corrupt?'and rejects corruption':'without overwrite'),async t=>{
  const f=await fixture(t);let calls=0;const winner=corrupt?Buffer.from('corrupt winner'):deflateSync(raw(f.bytes));let identity;
  const action=f.store({async assertAuthorized(){if(++calls===3){await writeFile(f.target,winner,{flag:'wx'});identity=await lstat(f.target,{bigint:true});}}});
  if(corrupt)await assert.rejects(action,unknown);else assert.deepEqual(await action,{oid:oidFor(f.bytes),created:false});
  assert.deepEqual(await readFile(f.target),winner);assert.equal((await lstat(f.target,{bigint:true})).ino,identity.ino);assert.equal((await lstat(f.target)).nlink,1);await noTemps(f);
});

test('existing hardlink object rejected without touching either link',async t=>{
  const f=await fixture(t);await seed(f,deflateSync(raw(f.bytes)));const alias=path.join(f.root,'alias');
  if(!await optionalLink(t,()=>link(f.target,alias)))return;
  await assert.rejects(f.store(),code('vcs/blob-unsafe'));assert.equal((await lstat(alias)).nlink,2);assert.deepEqual(await readFile(alias),await readFile(f.target));
});

test('symlink object rejected without following or replacing it',async t=>{
  const f=await fixture(t);await mkdir(f.fanout);const other=path.join(f.root,'foreign');await writeFile(other,deflateSync(raw(f.bytes)));
  if(!await optionalLink(t,()=>symlink(other,f.target,'file')))return;
  await assert.rejects(f.store(),code('vcs/blob-unsafe'));assert.equal((await lstat(f.target)).isSymbolicLink(),true);
});

for(const part of ['.git','objects','fanout','info'])test('reject linked '+part+' directory',async t=>{
  const f=await fixture(t);if(part==='fanout')await mkdir(f.fanout);
  const target=part==='.git'?f.gitDirectory:part==='objects'?path.join(f.gitDirectory,'objects'):part==='info'?path.join(f.gitDirectory,'objects','info'):f.fanout;
  const moved=path.join(f.root,'moved');await rename(target,moved);
  if(!await optionalLink(t,()=>symlink(moved,target,process.platform==='win32'?'junction':'dir')))return;
  await assert.rejects(f.store(),code('vcs/blob-unsafe'));assert.equal((await lstat(target)).isSymbolicLink(),true);
});

for(const name of ['alternates','http-alternates'])test('reject '+name+' even when empty',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.gitDirectory,'objects','info',name),'');await assert.rejects(f.store(),code('vcs/blob-unsafe'));await absent(f.fanout);
});

for(const format of ['sha1','sha256'])test('packed-only existing '+format+' blob permits correct loose duplicate',async t=>{
  const f=await fixture(t,format,true);const result=await f.store();
  execFileSync('git',['-C',f.root,'pack-objects',path.join(f.gitDirectory,'objects','pack','fixture')],{env:f.env,input:result.oid+'\n',stdio:'pipe'});
  await unlink(f.target);
  assert.deepEqual(execFileSync('git',['-C',f.root,'cat-file','blob',result.oid],{env:f.env,stdio:'pipe'}),f.bytes);
  assert.deepEqual(await f.store(),{oid:result.oid,created:true});
  assert.deepEqual(execFileSync('git',['-C',f.root,'cat-file','blob',result.oid],{env:f.env,stdio:'pipe'}),f.bytes);await noTemps(f);
});

test('foreign replacement temp is retained on failure, never unlinked as owned',async t=>{
  const f=await fixture(t);let calls=0,foreign,retained;
  await assert.rejects(f.store({async assertAuthorized(){if(++calls===3){
    const name=(await readdir(f.fanout)).find(x=>x.startsWith('.dsh-blob-'));
    foreign=path.join(f.fanout,name);retained=path.join(f.root,'retained-owned');
    await rename(foreign,retained);await writeFile(foreign,'foreign replacement');throw Error('revoked');
  }}}),unknown);
  assert.equal(await readFile(foreign,'utf8'),'foreign replacement');assert.deepEqual(inflateSync(await readFile(retained)),raw(f.bytes));await absent(f.target);
});

test('reject shared metadata and nonembedded directory',async t=>{
  const f=await fixture(t);await writeFile(path.join(f.gitDirectory,'commondir'),'..');await assert.rejects(f.store(),code('vcs/blob-unsafe'));
  await assert.rejects(f.store({gitDirectory:f.root}),code('vcs/blob-invalid'));
});
