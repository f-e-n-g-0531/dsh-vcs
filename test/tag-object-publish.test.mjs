import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,readFile,writeFile,mkdir,readdir,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {encodeGitCommit} from '../src/git-commit-object.mjs';
import {encodeGitTag} from '../src/git-tag-object.mjs';
import {publishTagObject} from '../tag-object-publish.mjs';

const identity={name:'Tag Publisher',email:'tag@example.com',timestamp:123,timezone:'+0000'};
const hash=(type,body,format='sha1')=>createHash(format).update(type+' '+body.length+'\0').update(body).digest('hex');
const invalid=e=>e.code==='vcs/tag-object-invalid';
const unknown=e=>e.code==='vcs/tag-object-outcome-unknown'&&e.appendOnly===true&&e.outcomeUnknown===true;
async function fixture(t,objectFormat='sha1'){
 const dir=await mkdtemp(path.join(tmpdir(),'dsh-tag-publish-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const root=await realpath(dir),gitDirectory=path.join(root,'.git');
 const env={...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'no-global')};
 const run=(args,input)=>execFileSync('git',args,{env,input,stdio:'pipe'});
 run(['init','-q','--object-format='+objectFormat,root]);
 const git=(...args)=>run(['-C',root,...args]);
 const tree=run(['-C',root,'hash-object','-w','-t','tree','--stdin'],Buffer.alloc(0)).toString().trim();
 const target=encodeGitCommit({tree,author:identity,committer:identity,message:'target commit'},{objectFormat});
 assert.equal(run(['-C',root,'hash-object','-w','-t','commit','--stdin'],target.body).toString().trim(),target.oid);
 const tag=encodeGitTag({object:target.oid,tag:'release/focused',tagger:identity,message:'Exact tag message\r\n末尾 without newline'},{objectFormat});
 const objectPath=oid=>path.join(gitDirectory,'objects',oid.slice(0,2),oid.slice(2));
 const options={gitDirectory,objectFormat,target,tag,assertAuthorized(){},onStart(){}};
 return {gitDirectory,git,options,objectPath};
}
async function assertNoPublication(f,expected){
 assert.equal(existsSync(f.objectPath(f.options.tag.oid)),false);
 assert.deepEqual(await readdir(path.join(f.gitDirectory,'objects')),expected);
 assert.equal(f.git('for-each-ref').length,0);
}
for(const format of ['sha1','sha256']){
 test('real '+format+' publication preserves exact cat-file bytes, HEAD, index and absent refs',async t=>{
  const f=await fixture(t,format),head=await readFile(path.join(f.gitDirectory,'HEAD'));
  const index=Buffer.from('opaque index sentinel');await writeFile(path.join(f.gitDirectory,'index'),index);
  const targetBefore=await readFile(f.objectPath(f.options.target.oid));let starts=0;
  assert.deepEqual(await publishTagObject({...f.options,onStart(){starts++;}}),{oid:f.options.tag.oid,created:true});
  assert.equal(starts,1);assert.deepEqual(f.git('cat-file','tag',f.options.tag.oid),f.options.tag.body);
  assert.equal(f.git('cat-file','-t',f.options.tag.oid).toString().trim(),'tag');
  assert.deepEqual(await readFile(f.objectPath(f.options.target.oid)),targetBefore);
  assert.deepEqual(await readFile(path.join(f.gitDirectory,'HEAD')),head);
  assert.deepEqual(await readFile(path.join(f.gitDirectory,'index')),index);assert.equal(f.git('for-each-ref').length,0);
 });
 test(format+' hash-correct tag targeting a different commit refuses before authorization/start',async t=>{
  const f=await fixture(t,format),before=await readdir(path.join(f.gitDirectory,'objects'));let calls=0;
  const other=encodeGitCommit({tree:'2'.repeat(format==='sha1'?40:64),author:identity,committer:identity,message:'other'},{objectFormat:format});
  f.options.tag=encodeGitTag({object:other.oid,tag:'release/other',tagger:identity,message:'mismatch'},{objectFormat:format});
  assert.equal(hash('tag',f.options.tag.body,format),f.options.tag.oid);
  await assert.rejects(publishTagObject({...f.options,assertAuthorized(){calls++;},onStart(){calls++;}}),invalid);
  assert.equal(calls,0);await assertNoPublication(f,before);
 });
 test(format+' existing valid tag returns created false without start or rewrite',async t=>{
  const f=await fixture(t,format);await publishTagObject(f.options);
  const before=await readFile(f.objectPath(f.options.tag.oid));let starts=0;
  assert.deepEqual(await publishTagObject({...f.options,onStart(){starts++;}}),{oid:f.options.tag.oid,created:false});
  assert.equal(starts,0);assert.deepEqual(await readFile(f.objectPath(f.options.tag.oid)),before);assert.equal(f.git('for-each-ref').length,0);
 });
}
for(const location of ['target','tag'])for(const mode of ['tampered','hash-correct malformed'])test(location+' '+mode+' body rejects before authorization/start',async t=>{
 const f=await fixture(t),before=await readdir(path.join(f.gitDirectory,'objects'));let calls=0;
 if(mode==='tampered')f.options[location].body[0]^=1;
 else {const body=Buffer.from('not a canonical '+location);f.options[location]={body,oid:hash(location==='target'?'commit':'tag',body)};}
 await assert.rejects(publishTagObject({...f.options,assertAuthorized(){calls++;},onStart(){calls++;}}),invalid);
 assert.equal(calls,0);await assertNoPublication(f,before);
});
for(const location of ['options','target','tag'])for(const kind of ['extra','symbol','accessor'])test(location+' '+kind+' rejected without invoking getter or authorization',async t=>{
 const f=await fixture(t),before=await readdir(path.join(f.gitDirectory,'objects'));let calls=0,getters=0;
 const options={...f.options,assertAuthorized(){calls++;},onStart(){calls++;}};
 const record=location==='options'?options:options[location];
 if(kind==='accessor')Object.defineProperty(record,location==='options'?'signal':'body',{configurable:true,get(){getters++;throw Error('must not evaluate');}});
 else Object.defineProperty(record,kind==='symbol'?Symbol('extra'):'extra',{value:1});
 await assert.rejects(publishTagObject(options),invalid);assert.equal(calls,0);assert.equal(getters,0);await assertNoPublication(f,before);
});
test('authorization mutations cannot replace captured target, tag, options or callback',async t=>{
 const f=await fixture(t),oid=f.options.tag.oid,body=Buffer.from(f.options.tag.body),targetOid=f.options.target.oid;let starts=0,mutated=false;
 f.options.onStart=()=>{starts++;};
 f.options.assertAuthorized=()=>{
  if(mutated)return;mutated=true;f.options.target.body.fill(0);f.options.tag.body.fill(0);
  f.options.target.oid='f'.repeat(40);f.options.tag.oid='e'.repeat(40);
  f.options.target={};f.options.tag={};f.options.objectFormat='sha256';f.options.gitDirectory='bad';
  f.options.onStart=()=>assert.fail('replacement callback');f.options.assertAuthorized=()=>assert.fail('replacement authorization');
 };
 assert.deepEqual(await publishTagObject(f.options),{oid,created:true});assert.equal(starts,1);
 assert.deepEqual(f.git('cat-file','tag',oid),body);assert.equal(f.git('cat-file','-t',targetOid).toString().trim(),'commit');
});
test('corrupt existing object refuses without start and remains untouched',async t=>{
 const f=await fixture(t),file=f.objectPath(f.options.tag.oid),corrupt=Buffer.from('corrupt loose object');
 await mkdir(path.dirname(file),{recursive:true});await writeFile(file,corrupt);let starts=0;
 await assert.rejects(publishTagObject({...f.options,onStart(){starts++;}}),e=>e.code==='vcs/object-corrupt');
 assert.equal(starts,0);assert.deepEqual(await readFile(file),corrupt);assert.equal(f.git('for-each-ref').length,0);
});
for(const mode of ['abort','authorization'])test('pre-start '+mode+' preserves specific original failure with no mutation',async t=>{
 const f=await fixture(t),before=await readdir(path.join(f.gitDirectory,'objects')),reason=Object.assign(Error('specific refusal'),{code:'test/refused'}),controller=new AbortController();let starts=0,auth=0;
 if(mode==='abort')controller.abort(reason);
 await assert.rejects(publishTagObject({...f.options,signal:controller.signal,onStart(){starts++;},assertAuthorized(){auth++;if(mode==='authorization')throw reason;}}),e=>e===reason);
 assert.equal(starts,0);assert.equal(auth,mode==='abort'?0:1);await assertNoPublication(f,before);
});
for(const mode of ['abort','authorization'])test('post-start '+mode+' is unknown and retains final published object',async t=>{
 const f=await fixture(t),controller=new AbortController(),reason=Error('revoked after final object');let starts=0,triggered=false;
 await assert.rejects(publishTagObject({...f.options,signal:controller.signal,onStart(){starts++;},assertAuthorized(){
  if(existsSync(f.objectPath(f.options.tag.oid))){triggered=true;if(mode==='abort')controller.abort(reason);else throw reason;}
 }}),unknown);
 assert.equal(triggered,true);assert.equal(starts,1);assert.deepEqual(f.git('cat-file','tag',f.options.tag.oid),f.options.tag.body);
 assert.deepEqual(await readdir(path.dirname(f.objectPath(f.options.tag.oid))),[f.options.tag.oid.slice(2)]);assert.equal(f.git('for-each-ref').length,0);
});
test('thenable onStart is outcome unknown even before object creation',async t=>{
 const f=await fixture(t);let starts=0,thenCalls=0;
 await assert.rejects(publishTagObject({...f.options,onStart(){starts++;return {then(resolve){thenCalls++;resolve();}};}}),unknown);
 assert.equal(starts,1);assert.equal(thenCalls,1);assert.equal(existsSync(f.objectPath(f.options.tag.oid)),false);assert.equal(f.git('for-each-ref').length,0);
});
