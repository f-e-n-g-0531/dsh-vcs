import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createVerifiedBranchDeletePlan as plan} from '../src/verified-branch-delete-plan.mjs';
import {createBranchDeletePlan} from '../src/branch-delete-plan.mjs';

const MiB=1024*1024;
const literals={
 sha1:['401aa1455fd441042d19d5f40da7acec286d2794','d033cc007c30b50d4658848c7504bd816f097764','05256a67fad1306db4e6c89b1d626baaf45150ab','fcb373e322f8314846f54964cdf8df8ba9a6c030'],
 sha256:['f0a285e8e88e97127ded9712c235149be033c96f1b853a1a10b2e882ef4ca905','1e94e861079f073a4a4336fc538ff7b47fff93a4acff7b5dc87a9241fc9847b1','8912f3f3cc335e10abe8c82bf02c8b80efdf257c4bd88aa82a383fd5b8ea139d','4255f15778a99502b1f9e65ca352f10ad840d82db5ab1ae70e754f81abdd705e'],
};
function body(format,parents=[],message='root\n'){
 return Buffer.concat([Buffer.from('tree '+'1'.repeat(format==='sha1'?40:64)+'\n'+parents.map(p=>'parent '+p+'\n').join('')+'author A <a@example.com> 1 +0000\ncommitter A <a@example.com> 1 +0000\n\n'),Buffer.isBuffer(message)?message:Buffer.from(message)]);
}
function object(bytes,format='sha1'){
 return {oid:createHash(format).update('commit '+bytes.length+'\0').update(bytes).digest('hex'),body:bytes};
}
function fixture(format='sha1',merge=false){
 const ids=literals[format];
 const objects=[{oid:ids[0],body:body(format)},{oid:ids[1],body:body(format,[ids[0]],'child\n')}];
 if(merge)objects.push({oid:ids[2],body:body(format,[ids[0]],'side\n')},{oid:ids[3],body:body(format,[ids[1],ids[2]],'merge\n')});
 return {objectFormat:format,current:{ref:'refs/heads/main',oid:objects.at(-1).oid},target:{ref:'refs/heads/topic',oid:ids[0]},objects};
}
function rootInput(objects,format='sha1'){
 return {objectFormat:format,current:{ref:'refs/heads/main',oid:objects[0].oid},target:{ref:'refs/heads/topic',oid:objects[0].oid},objects};
}
for(const format of ['sha1','sha256'])for(const merge of [false,true])test('literal '+format+' '+(merge?'merge':'chain')+' exact frozen underlying shape',()=>{
 const input=fixture(format,merge),ids=literals[format];
 const commits=[{oid:ids[0],parents:[]},{oid:ids[1],parents:[ids[0]]}];
 if(merge)commits.push({oid:ids[2],parents:[ids[0]]},{oid:ids[3],parents:[ids[1],ids[2]]});
 const expected=createBranchDeletePlan({objectFormat:format,current:input.current,target:input.target,commits});
 const result=plan(input);assert.deepEqual(result,expected);
 assert.deepEqual(Object.keys(result),['id','action','objectFormat','current','target','merged','proof']);
 for(const value of [result,result.current,result.target,result.proof])assert.ok(Object.isFrozen(value));
 input.objects.reverse();assert.deepEqual(plan(input),result);
});
test('default format and null-prototype records',()=>{
 const input=fixture();delete input.objectFormat;
 for(const key of ['current','target'])input[key]=Object.assign(Object.create(null),input[key]);
 input.objects=input.objects.map(row=>Object.assign(Object.create(null),row));
 assert.equal(plan(Object.assign(Object.create(null),input)).objectFormat,'sha1');
});
for(const format of ['sha1','sha256'])test('wrong oid and tampered opaque message reject '+format,()=>{
 const input=fixture(format);input.objects[1].oid='2'.repeat(format==='sha1'?40:64);
 assert.throws(()=>plan(input),/object id mismatch/);
 const changed=fixture(format);changed.objects[1].body[changed.objects[1].body.length-2]^=1;
 assert.throws(()=>plan(changed),/object id mismatch/);
});
test('message is opaque and cannot inject parents or malformed headers',()=>{
 const bytes=body('sha1',[],Buffer.from('parent '+literals.sha1[1]+'\n\ngpgsig fake\r\n\0\xff','latin1'));
 const input=rootInput([object(bytes)]);assert.deepEqual(plan(input).proof,[input.current.oid]);
});
const malformed=[
 ['duplicate tree',b=>Buffer.from(b.toString().replace('author A','tree '+'2'.repeat(40)+'\nauthor A'))],
 ['duplicate author',b=>Buffer.from(b.toString().replace('committer A','author A <a@example.com> 1 +0000\ncommitter A'))],
 ['duplicate parent',()=>body('sha1',[literals.sha1[0],literals.sha1[0]])],
 ['signature',b=>Buffer.from(b.toString().replace('\n\n','\ngpgsig unsupported\n continuation\n\n'))],
 ['CRLF',b=>Buffer.from(b.toString().replace('\n','\r\n'))],
 ['missing separator',b=>Buffer.from(b.toString().replace('\n\n','\n'))],
 ['unknown header',b=>Buffer.from(b.toString().replace('\n\n','\nx-custom ignored\n\n'))],
];
for(const [name,mutate] of malformed)test('hash-correct malformed '+name+' rejects',()=>{
 const row=object(mutate(body('sha1')));assert.throws(()=>plan(rootInput([row])),/header|parent|separator|framing/i);
});
test('every object is authenticated even when disconnected and not on proof',()=>{
 const input=fixture();input.objects.push({oid:'3'.repeat(40),body:body('sha1')});
 assert.throws(()=>plan(input),/object id mismatch/);
 input.objects[2]=object(malformed[0][1](body('sha1')));assert.throws(()=>plan(input),/header/i);
});
test('closed graph, required tips, duplicate nodes and unmerged rejection',()=>{
 const missing=fixture();missing.objects.shift();assert.throws(()=>plan(missing),/Missing current or target/);
 const ids=literals.sha1;
 const truncated=fixture('sha1',true);truncated.objects.splice(2,1);assert.throws(()=>plan(truncated),/closed/);
 const duplicate=fixture();duplicate.objects.push(duplicate.objects[0]);assert.throws(()=>plan(duplicate),/Duplicate commit/);
 const unmerged=fixture('sha1',true);unmerged.current.oid=ids[1];unmerged.target.oid=ids[2];assert.throws(()=>plan(unmerged),/not merged/);
 const wrong=fixture();wrong.current.oid='4'.repeat(40);assert.throws(()=>plan(wrong),/Missing current or target/);
});
test('fake cyclic caller graph cannot bypass byte authentication',()=>{
 const input=fixture();input.objects[0].parents=[input.current.oid];assert.throws(()=>plan(input),/Unsupported/);
 delete input.objects[0].parents;input.objects[0].body=body('sha1',[input.current.oid]);assert.throws(()=>plan(input),/object id mismatch/);
 // A real content-addressed cycle requires solving hash fixed points; do not fake a
 // supposedly authenticated cycle by overwriting OIDs or injecting parent fields.
});
for(const mutate of [x=>x.current.ref='main',x=>x.target.ref=x.current.ref,x=>x.target.ref='refs/heads/MAIN',x=>x.target.ref='refs/tags/topic',x=>x.target.ref='refs/heads/bad..name'])test('underlying portable/current ref policy '+mutate,()=>{
 const input=fixture();mutate(input);assert.throws(()=>plan(input),/branch|portable|refs/i);
});
for(const key of ['parents','merged','force','commits','authenticated'])test('reject input assertion '+key,()=>{
 const input=fixture();input[key]=true;assert.throws(()=>plan(input),/Unsupported/);
});
for(const select of [x=>x,x=>x.current,x=>x.target,x=>x.objects[0]])test('strict own-data records '+select,()=>{
 for(const key of ['extra',Symbol('extra')]){const input=fixture();select(input)[key]=true;assert.throws(()=>plan(input),/Unsupported/);}
 const input=fixture(),record=select(input),key=Object.keys(record).find(key=>key!=='objectFormat');let reads=0;
 Object.defineProperty(record,key,{get(){reads++;throw Error('evaluated getter');}});
 assert.throws(()=>plan(input),/own data/);assert.equal(reads,0);
 const missing=fixture();delete select(missing)[key];assert.throws(()=>plan(missing),/Missing/);
 const inherited=fixture();Object.setPrototypeOf(select(inherited),{});assert.throws(()=>plan(inherited),/record/);
});
test('strict dense own-data arrays reject holes, extras, symbols and getters',()=>{
 for(const key of ['extra',Symbol('extra')]){const input=fixture();input.objects[key]=true;assert.throws(()=>plan(input),/dense/);}
 const hole=fixture();delete hole.objects[0];assert.throws(()=>plan(hole),/dense/);
 let reads=0;const input=fixture();Object.defineProperty(input.objects,'0',{get(){reads++;throw Error('array getter');}});
 assert.throws(()=>plan(input),/own data/);assert.equal(reads,0);
 const inherited=fixture();Object.setPrototypeOf(inherited.objects,null);assert.throws(()=>plan(inherited),/array/);
});
for(const value of ['SHA1','sha512',null,false])test('reject format '+value,()=>{
 const input=fixture();input.objectFormat=value;assert.throws(()=>plan(input),/format/);
});
for(const value of ['',null,4,'0'.repeat(40),'A'.repeat(40),'a'.repeat(64)])test('reject oid '+value,()=>{
 for(const select of [x=>x.current,x=>x.target,x=>x.objects[0]]){const input=fixture();select(input).oid=value;assert.throws(()=>plan(input),/object id/);}
});
for(const value of [null,'text',new Uint8Array(8),{}])test('reject non Buffer '+String(value),()=>{
 const input=fixture();input.objects[0].body=value;assert.throws(()=>plan(input),/Buffer/);
});
test('all original bodies, rows, tips and input properties captured before any signal callback',()=>{
 const input=fixture('sha1',true),expected=plan(input);let calls=0;
 input.signal={get aborted(){
  calls++;for(const row of input.objects){row.body.fill(0);row.oid='0'.repeat(40);row.body=Buffer.alloc(0);}
  input.current.oid='0'.repeat(40);input.current.ref='bad';input.target.oid='0'.repeat(40);input.target.ref='bad';
  input.objects.length=0;input.objectFormat='sha256';return false;
 },throwIfAborted(){this.aborted;}};
 assert.deepEqual(plan(input),expected);assert.ok(calls>10);
});
test('body instance overrides cannot run during capture/copy',()=>{
 const input=fixture();let calls=0;
 for(const row of input.objects){Object.defineProperty(row.body,'length',{get(){calls++;throw Error('length getter');}});row.body.copy=()=>{calls++;throw Error('copy override');};row.body[Symbol.iterator]=()=>{calls++;throw Error('iterator override');};}
 assert.equal(plan(input).merged,true);assert.equal(calls,0);
});
test('native abort, cooperative early abort, and late phase abort propagate',()=>{
 const controller=new AbortController();controller.abort();assert.throws(()=>plan({...fixture(),signal:controller.signal}),{name:'AbortError'});
 assert.throws(()=>plan({...fixture(),signal:{aborted:true}}),{name:'AbortError'});
 for(const limit of [1,3,10,25]){
  let calls=0;const signal={get aborted(){return ++calls>=limit;}};
  assert.throws(()=>plan({...fixture('sha1',true),signal}),{name:'AbortError'});assert.ok(calls>=limit);
 }
 const marker=new Error('cooperative sentinel');assert.throws(()=>plan({...fixture(),signal:{throwIfAborted(){throw marker;}}}),error=>error===marker);
});
test('count/body/aggregate limits reject before any copy or signal callback',()=>{
 let calls=0;const signal={get aborted(){calls++;throw Error('signal must not run');}};
 const count=fixture();count.signal=signal;count.objects=Array(10001).fill(count.objects[0]);assert.throws(()=>plan(count),/count limit/);
 const oversized=fixture();oversized.signal=signal;oversized.objects[0].body=Buffer.alloc(2*MiB+1);assert.throws(()=>plan(oversized),/body byte limit/);
 const aggregate=fixture();aggregate.signal=signal;aggregate.objects=Array.from({length:9},()=>({oid:'1'.repeat(40),body:Buffer.alloc(2*MiB)}));
 const alloc=Buffer.alloc;let copies=0;Buffer.alloc=(...args)=>{copies++;return alloc(...args);};
 try{assert.throws(()=>plan(aggregate),/Aggregate/);}finally{Buffer.alloc=alloc;}
 assert.equal(copies,0);assert.equal(calls,0);
});
test('exact body and aggregate byte limits accept valid objects',()=>{
 const objects=Array.from({length:8},(_,i)=>{
  const head=body('sha1',[],String(i));const bytes=Buffer.alloc(2*MiB,120);head.copy(bytes);return object(bytes);
 });
 assert.equal(plan(rootInput(objects)).merged,true);
});
test('exact 10000 nodes accepted with closed independent roots',()=>{
 const objects=Array.from({length:10000},(_,i)=>object(body('sha1',[],String(i))));
 assert.equal(plan(rootInput(objects)).merged,true);
});
test('transparent own-data proxies supported without claiming atomic proxy capture',()=>{
 const input=fixture();input.objects=input.objects.map(row=>new Proxy(row,{}));
 assert.equal(plan(new Proxy(input,{})).merged,true);
});
