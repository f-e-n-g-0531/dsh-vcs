import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, realpath, readFile, writeFile, rm, lstat, readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash, randomBytes} from 'node:crypto';
import {deflateSync, inflateSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {storeCapturedObject, MAX_TAG_BYTES} from '../git-object-store.mjs';
import {encodeGitTag} from '../src/git-tag-object.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';

const code = value => e => e.code === value;
const unknown = e => e.code === 'vcs/object-outcome-unknown' && e.appendOnly === true && e.outcomeUnknown === true;
const raw = bytes => Buffer.concat([Buffer.from('tag '+bytes.length+'\0'),bytes]);
const oidFor = (bytes,format='sha1') => createHash(format).update(raw(bytes)).digest('hex');
async function absent(file) {await assert.rejects(lstat(file),code('ENOENT'));}
async function fixture(t,format='sha1',git=false) {
  const dir=await mkdtemp(path.join(tmpdir(),'dsh-tag-store-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const root=await realpath(dir),gitDirectory=path.join(root,'.git');
  const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'no-global-config')};
  const run=(...args)=>execFileSync('git',['-C',root,...args],{env,stdio:'pipe'});
  if(git)run('init','-q','--object-format='+format);
  else {await mkdir(gitDirectory);await mkdir(path.join(gitDirectory,'objects'));}
  const bytes=Buffer.from('opaque tag\0\xff\r\n','latin1');
  const options={gitDirectory,objectFormat:format,type:'tag',bytes,assertAuthorized(){},onStart(){}};
  const targetFor=b=>{const oid=oidFor(b,format);return path.join(gitDirectory,'objects',oid.slice(0,2),oid.slice(2));};
  const target=targetFor(bytes),fanout=path.dirname(target);
  return {root,gitDirectory,env,run,bytes,target,fanout,targetFor,store:extra=>storeCapturedObject({...options,...extra})};
}
async function snapshot(root,skipObjects=false) {
  const out=[];
  for(const name of (await readdir(root)).sort()) {
    if(skipObjects && name==='objects')continue;
    const file=path.join(root,name),s=await lstat(file,{bigint:true});
    out.push([name,s.ino,s.mtimeNs,s.isDirectory()?await snapshot(file):await readFile(file)]);
  }
  return out;
}

for(const format of ['sha1','sha256'])test('encoded tag exact Git framing/hash/cat-file and no repository side writes '+format,async t=>{
  const f=await fixture(t,format,true);
  await writeFile(path.join(f.root,'work.txt'),'unchanged work');
  f.run('add','work.txt');
  f.run('-c','user.name=T','-c','user.email=t@example.com','commit','-qm','fixture');
  const object=f.run('rev-parse','HEAD').toString().trim();
  const input={object,tag:'release/安全',tagger:{name:'T',email:'t@example.com',timestamp:1,timezone:'+0000'},message:'\ufeffexact\r\nmessage\twithout final newline'};
  const encoded=encodeGitTag(input,{objectFormat:format});
  const expected=execFileSync('git',['-C',f.root,'hash-object','-t','tag','--stdin'],{env:f.env,input:encoded.body,stdio:'pipe'}).toString().trim();
  assert.equal(encoded.oid,expected);assert.equal(oidFor(encoded.body,format),expected);
  const before=await snapshot(f.gitDirectory,true),work=await readFile(path.join(f.root,'work.txt'));
  let starts=0;
  const result=await f.store({bytes:encoded.body,onStart(){starts++;assert.equal(existsSync(f.targetFor(encoded.body)),false);}});
  assert.deepEqual(result,{oid:expected,created:true});assert.equal(starts,1);
  assert.equal(f.run('cat-file','-t',expected).toString().trim(),'tag');
  assert.deepEqual(f.run('cat-file','tag',expected),encoded.body);
  const target=f.targetFor(encoded.body),compressed=await readFile(target),stat=await lstat(target,{bigint:true});
  assert.deepEqual(inflateSync(compressed),raw(encoded.body));assert.equal(stat.nlink,1n);
  assert.deepEqual(await f.store({bytes:encoded.body,onStart(){assert.fail('existing tag must not start');}}),{oid:expected,created:false});
  const after=await lstat(target,{bigint:true});assert.equal(after.ino,stat.ino);assert.equal(after.mtimeNs,stat.mtimeNs);assert.equal(after.ctimeNs,stat.ctimeNs);
  assert.deepEqual(await readFile(target),compressed);
  assert.deepEqual(await snapshot(f.gitDirectory,true),before);assert.deepEqual(await readFile(path.join(f.root,'work.txt')),work);
  assert.deepEqual(await readdir(f.root),['.git','work.txt']);
});

for(const kind of ['junk','mismatched body','wrong type','wrong length','trailing compressed bytes','concatenated stream','truncated','inflate bound','compressed bound'])test('existing tag refuses '+kind+' without overwrite/start',async t=>{
  const f=await fixture(t),valid=deflateSync(raw(f.bytes));
  const data=kind==='junk'?Buffer.from('not zlib'):kind==='mismatched body'?deflateSync(raw(Buffer.alloc(f.bytes.length,7))):kind==='wrong type'?deflateSync(Buffer.concat([Buffer.from('tree '+f.bytes.length+'\0'),f.bytes])):kind==='wrong length'?deflateSync(Buffer.concat([Buffer.from('tag 0\0'),f.bytes])):kind==='trailing compressed bytes'?Buffer.concat([valid,Buffer.from('extra')]):kind==='concatenated stream'?Buffer.concat([valid,deflateSync(Buffer.alloc(0))]):kind==='truncated'?valid.subarray(0,-1):kind==='inflate bound'?deflateSync(Buffer.alloc(MAX_TAG_BYTES+100)):Buffer.alloc(MAX_TAG_BYTES+1024*1024+1);
  await mkdir(f.fanout);await writeFile(f.target,data);const before=await lstat(f.target,{bigint:true});
  await assert.rejects(f.store({onStart(){assert.fail('corrupt existing must not start');}}),code('vcs/object-corrupt'));
  const after=await lstat(f.target,{bigint:true});assert.equal(after.ino,before.ino);assert.equal(after.mtimeNs,before.mtimeNs);assert.equal(after.ctimeNs,before.ctimeNs);
  assert.deepEqual(await readFile(f.target),data);assert.deepEqual(await readdir(f.fanout),[path.basename(f.target)]);
});

test('tag capture precedes first awaited authorization and caller mutation',async t=>{
  const f=await fixture(t),captured=Buffer.from(f.bytes);let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const pending=f.store({assertAuthorized:()=>gate});f.bytes.fill(9);release();
  assert.deepEqual(await pending,{oid:oidFor(captured),created:true});assert.deepEqual(inflateSync(await readFile(f.target)),raw(captured));
});

for(const format of ['sha1','sha256'])test('opaque tags at exact 128KiB boundary, empty tags and invalid types '+format,async t=>{
  const f=await fixture(t,format);assert.equal(MAX_TAG_BYTES,128*1024);
  for(const bytes of [Buffer.alloc(0),randomBytes(MAX_TAG_BYTES)]) {
    let starts=0;const result=await f.store({bytes,onStart(){starts++;}});
    assert.deepEqual(result,{oid:oidFor(bytes,format),created:true});assert.equal(starts,1);
    assert.deepEqual(inflateSync(await readFile(f.targetFor(bytes))),raw(bytes));
  }
  const before=await snapshot(path.join(f.gitDirectory,'objects'));
  await assert.rejects(f.store({bytes:Buffer.alloc(MAX_TAG_BYTES+1),onStart(){assert.fail('oversize');}}),code('vcs/object-too-large'));
  for(const type of [undefined,null,'blob','TAG','tag\0','tag ','',new String('tag'),{toString(){throw Error('must not coerce');}}])await assert.rejects(f.store({type,onStart(){assert.fail('invalid type');}}),code('vcs/object-invalid'));
  assert.deepEqual(await snapshot(path.join(f.gitDirectory,'objects')),before);
});

for(const kind of ['abort','authorization','second authorization','ambient abort'])test('tag prestart '+kind+' leaves storage untouched',async t=>{
  const f=await fixture(t),c=new AbortController(),denied=Error('denied');let calls=0,starts=0;
  if(kind==='abort'||kind==='ambient abort')c.abort();
  const operation=()=>f.store({signal:kind==='abort'?c.signal:undefined,onStart(){starts++;},assertAuthorized(){if(kind==='authorization'||kind==='second authorization'&&++calls===2)throw denied;}});
  await assert.rejects(kind==='ambient abort'?withOperationBudget({signal:c.signal},operation):operation(),kind==='abort'||kind==='ambient abort'?{name:'AbortError'}:e=>e===denied);
  assert.equal(starts,0);assert.deepEqual(await readdir(path.join(f.gitDirectory,'objects')),[]);
});

test('tag start precedes fanout write and immediate cancellation is unknown',async t=>{
  const f=await fixture(t),c=new AbortController();let starts=0;
  await assert.rejects(f.store({signal:c.signal,onStart(){starts++;assert.equal(existsSync(f.fanout),false);c.abort();}}),unknown);
  assert.equal(starts,1);await absent(f.fanout);
});

for(const kind of ['abort','authorization'])test('tag poststart '+kind+' cleans only owned temp',async t=>{
  const f=await fixture(t),c=new AbortController();await mkdir(f.fanout);
  const foreign=path.join(f.fanout,'.dsh-object-foreign');await writeFile(foreign,'foreign');let starts=0,sawTemp=false;
  await assert.rejects(f.store({signal:c.signal,onStart(){starts++;},async assertAuthorized(){
    if(!starts)return;
    sawTemp=(await readdir(f.fanout)).some(x=>x.startsWith('.dsh-object-')&&x!=='.dsh-object-foreign');
    if(kind==='abort')c.abort();else throw Error('revoked');
  }}),unknown);
  assert.equal(starts,1);assert.equal(sawTemp,true);await absent(f.target);
  assert.deepEqual(await readdir(f.fanout),['.dsh-object-foreign']);assert.equal(await readFile(foreign,'utf8'),'foreign');
});

for(const kind of ['abort','authorization'])test('tag postpublication '+kind+' is unknown and never deletes final object',async t=>{
  const f=await fixture(t),c=new AbortController();let calls=0,starts=0;
  await assert.rejects(f.store({signal:c.signal,onStart(){starts++;},assertAuthorized(){if(++calls===4){if(kind==='abort')c.abort();else throw Error('revoked');}}}),unknown);
  assert.equal(starts,1);assert.deepEqual(inflateSync(await readFile(f.target)),raw(f.bytes));assert.equal((await lstat(f.target)).nlink,1);
  assert.deepEqual(await readdir(f.fanout),[path.basename(f.target)]);
});

for(const corrupt of [false,true])test('tag exclusive publication validates EEXIST winner '+corrupt,async t=>{
  const f=await fixture(t);let calls=0,starts=0,identity;
  const winner=corrupt?Buffer.from('foreign corrupt winner'):deflateSync(raw(f.bytes));
  const pending=f.store({onStart(){starts++;},async assertAuthorized(){if(++calls===3){await writeFile(f.target,winner,{flag:'wx'});identity=await lstat(f.target,{bigint:true});}}});
  if(corrupt)await assert.rejects(pending,unknown);else assert.deepEqual(await pending,{oid:oidFor(f.bytes),created:false});
  assert.equal(starts,1);assert.equal((await lstat(f.target,{bigint:true})).ino,identity.ino);assert.deepEqual(await readFile(f.target),winner);
  assert.deepEqual(await readdir(f.fanout),[path.basename(f.target)]);
});
