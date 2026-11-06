import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createVerifiedLightweightTagPlan} from '../src/lightweight-tag-plan.mjs';
import {createVerifiedTagPlan} from '../src/verified-tag-plan.mjs';

// Independent literal Git framing oracle; no production encoder builds fixtures.
const hash=(body,format='sha1')=>createHash(format).update(Buffer.from('commit '+body.length+'\0','ascii')).update(body).digest('hex');
function fixture(format='sha1',parents=[],message=Buffer.from('body'),tree='a'.repeat(format==='sha1'?40:64)){
 const body=Buffer.concat([Buffer.from(['tree '+tree,...parents.map(p=>'parent '+p),'author 测试 <test@example.invalid> 1700000000 +0800','committer Committer <c@example.invalid> 0 -0000'].join('\n')+'\n\n'),message]);
 return {body,target:hash(body,format),tree,format};
}
const inputs=(f,extra={})=>({objectFormat:f.format,target:f.target,name:'release/版本😀',...extra});
const plan=(f,extra={})=>createVerifiedLightweightTagPlan(f.body,inputs(f,extra));
const nullRecord=o=>Object.assign(Object.create(null),o);

test('SHA1/SHA256 root and merge exact frozen scalar shape and literal ID',()=>{
 for(const format of ['sha1','sha256'])for(const parents of [[],['b'.repeat(format==='sha1'?40:64),'c'.repeat(format==='sha1'?40:64)]]){
  const f=fixture(format,parents),p=plan(f),ref='refs/tags/release/版本😀';
  const id=createHash('sha256').update(JSON.stringify(['dsh-vcs:lightweight-tag-plan:v1',format,ref,f.target])).digest('hex');
  assert.deepEqual(p,{id,action:'lightweight-tag-create',objectFormat:format,name:'release/版本😀',ref,target:f.target,targetTree:f.tree});
  assert.ok(Object.isFrozen(p));assert.equal(id.length,64);
  assert.ok(Object.values(p).every(v=>typeof v==='string'));
  assert.throws(()=>{p.target='bad';},TypeError);
 }
 const f=fixture(),i=inputs(f);delete i.objectFormat;assert.deepEqual(createVerifiedLightweightTagPlan(f.body,i),plan(f));
});

test('authenticated header supplies tree; opaque message metadata never overrides it',()=>{
 const f=fixture('sha1',['b'.repeat(40)],Buffer.concat([Buffer.from('tree '+'c'.repeat(40)+'\nparent '+'d'.repeat(40)+'\ntag forged\n'),Buffer.from([0,255,13])]));
 assert.equal(plan(f).targetTree,f.tree);
 assert.throws(()=>plan(f,{target:'e'.repeat(40)}),/mismatch/);
 const corrupt=Buffer.from(f.body);corrupt[10]^=1;
 assert.throws(()=>createVerifiedLightweightTagPlan(corrupt,inputs(f)),/mismatch/);
});

test('valid hash cannot excuse malformed, signed, duplicate or reordered commit headers',()=>{
 for(const format of ['sha1','sha256']){
  const f=fixture(format),text=f.body.toString(),parent='b'.repeat(format==='sha1'?40:64);
  for(const raw of [text.replace('tree ','tree 0'),text.replace('author ','gpgsig sig\n continuation\nauthor '),text.replace('author ','mergetag bad\nauthor '),text.replace('author ','encoding UTF-8\nauthor '),text.replace('committer ','author '),text.replace('\n\n','\r\n\r\n'),text.replace('author ','parent '+parent+'\nparent '+parent+'\nauthor '),text.replace('tree ','unknown ')]){
   const body=Buffer.from(raw);assert.throws(()=>createVerifiedLightweightTagPlan(body,inputs(f,{target:hash(body,format)})));
  }
  const body=Buffer.from(text.replace('\n\n','\nencoding UTF-8\n\n'));
  assert.doesNotThrow(()=>createVerifiedLightweightTagPlan(body,inputs(f,{target:hash(body,format)})));
 }
});

test('strict own required fields, no annotated metadata, overrides, accessors or prototypes',()=>{
 const f=fixture();let calls=0;
 for(const key of ['target','name']){const i=inputs(f);delete i[key];assert.throws(()=>createVerifiedLightweightTagPlan(f.body,i));}
 for(const key of ['tag','tagger','message','type','ref','force','objects','object','oid','targetTree','parents','extra'])assert.throws(()=>plan(f,{[key]:undefined}));
 assert.throws(()=>plan(f,{[Symbol()]:1}));
 for(const key of ['objectFormat','target','name','signal']){
  const i=inputs(f);Object.defineProperty(i,key,{get(){calls++;throw Error('getter invoked');}});
  assert.throws(()=>createVerifiedLightweightTagPlan(f.body,i),/own data/);
 }
 for(const i of [null,[],new Date(),Object.create(inputs(f)),()=>{}])assert.throws(()=>createVerifiedLightweightTagPlan(f.body,i));
 assert.doesNotThrow(()=>createVerifiedLightweightTagPlan(f.body,nullRecord(inputs(f))));
 const i=inputs(f);Object.defineProperty(i,'name',{value:'v1',enumerable:false});assert.equal(createVerifiedLightweightTagPlan(f.body,i).name,'v1');
 const coercible={toString(){calls++;return 'v1';}};
 for(const extra of [{name:coercible},{target:coercible},{objectFormat:coercible}])assert.throws(()=>plan(f,extra));
 assert.equal(calls,0);
});

test('portable tag spelling and exact UTF8 whole/component bounds',()=>{
 const f=fixture(),whole=['a'.repeat(255),'b'.repeat(255),'c'.repeat(255),'d'.repeat(232)].join('/');
 assert.equal(Buffer.byteLength(whole),1000);
 for(const name of ['v1','版本/😀','é'.repeat(127)+'a',whole,'HeAd/v1','Refs/v1','COM10','é','e\u0301'])assert.equal(plan(f,{name}).name,name);
 const invalid=['','@','HEAD','head','HeAd','refs/v1','-v1','/v1','v1/','a//b','.x','a/.b','a.','a..b','a@{b','a.lock','a.LOCK','CON','con.txt','a/NuL.dat','COM1','lpt9.x','a b','a~b','a^b','a:b','a?b','a*b','a[b','a\\b','a<b','a>b','a"b','a|b','a\0b','a\tb','a\nb','a\u007fb','a\u0085b','a\u200db','a\ufeffb','\ud800','é'.repeat(128),whole+'x',Buffer.from('v1'),null];
 for(const name of invalid)assert.throws(()=>plan(f,{name}),undefined,String(name));
 assert.notEqual(plan(f,{name:'é'}).id,plan(f,{name:'e\u0301'}).id);
});

test('owned intrinsic raw copy precedes every options trap and bypasses Buffer instance methods',()=>{
 for(const trap of ['getPrototypeOf','ownKeys','getOwnPropertyDescriptor']){
  const f=fixture(),i=inputs(f);let calls=0;
  f.body.copy=()=>{throw Error('instance copy called');};
  f.body[Symbol.iterator]=()=>{throw Error('iterator called');};
  const proxy=new Proxy(i,{[trap](target,...args){calls++;f.body.fill(0);return Reflect[trap](target,...args);}});
  const p=createVerifiedLightweightTagPlan(f.body,proxy);assert.equal(p.target,f.target);assert.equal(p.targetTree,f.tree);assert.ok(calls>0);
 }
});

test('callbacks cannot mutate captured body, scalar inputs or captured cooperative signal',()=>{
 const f=fixture(),i=inputs(f),expected=plan(f);let calls=0;
 const signal={aborted:false,throwIfAborted(){assert.equal(this,signal);calls++;f.body.fill(0);i.name='evil';i.target='e'.repeat(40);i.objectFormat='sha256';i.signal={aborted:true};signal.aborted=true;signal.throwIfAborted=()=>{throw Error('replacement invoked');};}};
 i.signal=signal;assert.deepEqual(createVerifiedLightweightTagPlan(f.body,i),expected);assert.ok(calls>2);
});

test('ID binds exact ref/name, target (including tree) and format; not annotated domain',()=>{
 const f=fixture(),base=plan(f),ids=new Set([base.id,plan(f,{name:'release/v2'}).id,plan(fixture('sha256')).id,plan(fixture('sha1',[],Buffer.from('other'))).id,plan(fixture('sha1',[],Buffer.from('body'),'b'.repeat(40))).id]);
 assert.equal(ids.size,5);assert.equal(base.id,plan(f).id);
 const annotated=createVerifiedTagPlan(f.body,{target:f.target,tag:base.name,tagger:{name:'T',email:'t@x',timestamp:0,timezone:'+0000'},message:'tag'});
 assert.notEqual(base.id,annotated.id);
 const wrongDomain=createHash('sha256').update(JSON.stringify(['dsh-vcs:verified-tag-plan:v1',f.format,base.ref,f.target])).digest('hex');
 assert.notEqual(base.id,wrongDomain);
});

test('all scalar validation precedes first cancellation callback or signal descriptor trap',()=>{
 const f=fixture();let calls=0;const signal=new Proxy({throwIfAborted(){calls++;}},{getPrototypeOf(t){calls++;return Reflect.getPrototypeOf(t);}});
 for(const extra of [{target:'bad'},{target:'0'.repeat(40)},{target:'A'.repeat(40)},{target:'a'.repeat(64)},{name:'../bad'},{objectFormat:'sha512'},{objectFormat:null},{name:undefined},{target:undefined}])assert.throws(()=>plan(f,{...extra,signal}));
 assert.equal(calls,0);
});

test('native intrinsic cancellation preserves arbitrary reasons and avoids overridden getters',()=>{
 const f=fixture();let calls=0;
 for(const reason of [Error('stop'),'reason',null,42,{custom:true}]){
  const controller=new AbortController();controller.abort(reason);
  Object.defineProperty(controller.signal,'aborted',{get(){calls++;throw Error('own getter');}});
  Object.defineProperty(controller.signal,'throwIfAborted',{value(){calls++;throw Error('own method');}});
  assert.throws(()=>plan(f,{signal:controller.signal}),e=>e===reason);
 }
 const c=new AbortController();Object.defineProperty(c.signal,'aborted',{get(){calls++;return true;}});assert.doesNotThrow(()=>plan(f,{signal:c.signal}));
 assert.equal(calls,0);
 const reason={later:true};let checks=0;
 assert.throws(()=>plan(f,{signal:{throwIfAborted(){if(++checks===3)throw reason;}}}),e=>e===reason);assert.equal(checks,3);
});

test('cooperative strict own-data policy never invokes user accessors',()=>{
 const f=fixture();let getters=0;
 for(const key of ['aborted','throwIfAborted']){const signal={};Object.defineProperty(signal,key,{get(){getters++;f.body.fill(0);return false;}});assert.throws(()=>plan(f,{signal}),/own data/);}
 assert.equal(getters,0);
 assert.throws(()=>plan(f,{signal:{aborted:true}}),{name:'AbortError'});
 for(const signal of [null,[],{aborted:1},{aborted:null},{throwIfAborted:1},{extra:1},Object.create({aborted:false}),{[Symbol()]:1}])assert.throws(()=>plan(f,{signal}));
 for(const signal of [{},nullRecord({aborted:false}),{aborted:undefined,throwIfAborted:undefined}])assert.doesNotThrow(()=>plan(f,{signal}));
});

test('inclusive 2MiB body bound and invalid raw inputs rejected before options are touched',()=>{
 const f=fixture(),header=f.body.subarray(0,f.body.indexOf('\n\n')+2),body=Buffer.concat([header,Buffer.alloc(2*1024*1024-header.length,255)]);
 assert.equal(body.length,2*1024*1024);assert.equal(createVerifiedLightweightTagPlan(body,inputs(f,{target:hash(body)})).targetTree,f.tree);
 let calls=0;const i=new Proxy({}, {getPrototypeOf(){calls++;throw Error('options touched');}});
 for(const raw of [null,'body',new Uint8Array(f.body),Buffer.alloc(2*1024*1024+1)])assert.throws(()=>createVerifiedLightweightTagPlan(raw,i));
 assert.equal(calls,0);
});

test('temporary real Git agrees on commit target without creating any refs or tag objects',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dsh-lightweight-plan-'));
 try{
  for(const format of ['sha1','sha256']){
   const cwd=path.join(dir,format);execFileSync('git',['init','--quiet','--object-format='+format,cwd],{stdio:'pipe'});
   const git=(args,input)=>execFileSync('git',args,{cwd,input,encoding:'utf8'}).trim();
   const tree=git(['hash-object','-t','tree','-w','--stdin'],Buffer.alloc(0)),f=fixture(format,[],Buffer.from('actual target\n'),tree);
   const target=git(['hash-object','-t','commit','-w','--stdin'],f.body);
   assert.equal(target,f.target);const p=plan(f);assert.equal(p.target,target);assert.equal(p.targetTree,tree);
   assert.equal(git(['cat-file','-t',p.target]),'commit');assert.equal(git(['for-each-ref']), '');
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
