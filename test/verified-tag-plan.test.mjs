import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createVerifiedTagPlan} from '../src/verified-tag-plan.mjs';

// Independent literal/framing oracle: no production encoder/parser builds fixtures.
const person={name:'测试 Author',email:'test@example.invalid',timestamp:1700000000,timezone:'+0800'};
const hash=(type,body,format='sha1')=>createHash(format).update(Buffer.from(type+' '+body.length+'\0','ascii')).update(body).digest('hex');
const identity=p=>p.name+' <'+p.email+'> '+p.timestamp+' '+p.timezone;
function fixture(format='sha1',parents=[],message=Buffer.from('commit body')){
 const tree='a'.repeat(format==='sha1'?40:64);
 const body=Buffer.concat([Buffer.from(['tree '+tree,...parents.map(p=>'parent '+p),'author '+identity(person),'committer '+identity(person)].join('\n')+'\n\n'),message]);
 return {body,target:hash('commit',body,format),tree,format};
}
const inputs=(f,extra={})=>({objectFormat:f.format,target:f.target,tag:'release/v1',tagger:{...person},message:'正文',...extra});
const plan=(f,extra={})=>createVerifiedTagPlan(f.body,inputs(f,extra));
const nullRecord=o=>Object.assign(Object.create(null),o);
function expectedTag(f,i){return Buffer.concat([Buffer.from('object '+f.target+'\ntype commit\ntag '+i.tag+'\ntagger '+identity(i.tagger)+'\n\n'),Buffer.from(i.message)]);}

test('exact frozen shape and independent literal/hash/ID oracle for SHA1/SHA256 root and merge',()=>{
 for(const format of ['sha1','sha256'])for(const parents of [[],['b'.repeat(format==='sha1'?40:64),'c'.repeat(format==='sha1'?40:64)]]){
  const f=fixture(format,parents),i=inputs(f),p=createVerifiedTagPlan(f.body,i),body=expectedTag(f,i),oid=hash('tag',body,format),ref='refs/tags/release/v1';
  const id=createHash('sha256').update(JSON.stringify(['dsh-vcs:verified-tag-plan:v1',format,f.target,oid,ref])).digest('hex');
  assert.deepEqual(p,{id,action:'tag-create',objectFormat:format,target:f.target,targetTree:f.tree,tag:i.tag,ref,tagger:person,message:'正文',messageBytes:6,object:{oid,body}});
  for(const r of [p,p.tagger,p.object])assert.ok(Object.isFrozen(r));
  assert.ok(!Object.isFrozen(p.object.body));assert.equal(p.id.length,64);
 }
 const f=fixture(),i=inputs(f);delete i.objectFormat;assert.deepEqual(createVerifiedTagPlan(f.body,i),plan(f));
});

test('raw authenticated headers alone supply targetTree; message parent/tree lookalikes are opaque',()=>{
 const message=Buffer.concat([Buffer.from('tree '+'d'.repeat(40)+'\nparent '+'e'.repeat(40)+'\n'),Buffer.from([0,255,13])]);
 const f=fixture('sha1',['b'.repeat(40)],message),p=plan(f);
 assert.equal(p.targetTree,f.tree);assert.equal(p.target,hash('commit',f.body));
 assert.throws(()=>plan(f,{target:'f'.repeat(40)}),/mismatch/);
 const corrupt=Buffer.from(f.body);corrupt[10]^=1;assert.throws(()=>createVerifiedTagPlan(corrupt,inputs(f)),/mismatch/);
});

test('valid hashes do not excuse invalid, signed, reordered or duplicate commit headers',()=>{
 const f=fixture(),text=f.body.toString();
 for(const body of [text.replace('tree ','tree 0'),text.replace('author ','gpgsig sig\n more\nauthor '),text.replace('author ','mergetag bad\nauthor '),text.replace('author ','encoding UTF-8\nauthor '),text.replace('committer ','author '),text.replace('\n\n','\r\n\r\n'),text.replace('author ','parent '+'b'.repeat(40)+'\nparent '+'b'.repeat(40)+'\nauthor '),text.replace('tree ','unknown ')]){
  const raw=Buffer.from(body);assert.throws(()=>createVerifiedTagPlan(raw,inputs(f,{target:hash('commit',raw)})));
 }
});

test('strict own required input/tagger data records; no override, getter, coercion or prototype acceptance',()=>{
 const f=fixture();let calls=0;
 for(const field of ['target','tag','tagger','message']){const i=inputs(f);delete i[field];assert.throws(()=>createVerifiedTagPlan(f.body,i));}
 for(const field of ['targetTree','parents','object','objectOID','oid','type','ref','force','extra'])assert.throws(()=>plan(f,{[field]:'fake'}));
 assert.throws(()=>plan(f,{[Symbol()]:1}));
 for(const [base,invoke] of [[inputs(f),i=>createVerifiedTagPlan(f.body,i)],[person,t=>plan(f,{tagger:t})]]){
  for(const field of Object.keys(base)){
   const r={...base};Object.defineProperty(r,field,{get(){calls++;throw Error('getter ran');}});assert.throws(()=>invoke(r));
  }
  for(const r of [null,[],new Date(),Object.create(base)])assert.throws(()=>invoke(r));
 }
 for(const field of Object.keys(person)){const t={...person};delete t[field];assert.throws(()=>plan(f,{tagger:t}));}
 assert.doesNotThrow(()=>createVerifiedTagPlan(f.body,nullRecord({...inputs(f),tagger:nullRecord(person)})));
 const i=inputs(f);Object.defineProperty(i,'tag',{value:'v1',enumerable:false});assert.doesNotThrow(()=>createVerifiedTagPlan(f.body,i));
 const coercible={toString(){calls++;return 'v1';}};assert.throws(()=>plan(f,{tag:coercible}));assert.throws(()=>plan(f,{tagger:{...person,name:coercible}}));assert.equal(calls,0);
});

test('commit is copied before all inputs Proxy prototype/descriptor reads',()=>{
 for(const trap of ['getPrototypeOf','ownKeys','getOwnPropertyDescriptor']){
  const f=fixture(),i=inputs(f);let touched=0;
  const proxy=new Proxy(i,{[trap](target,...args){touched++;f.body.fill(0);return Reflect[trap](target,...args);}});
  const p=createVerifiedTagPlan(f.body,proxy);assert.equal(p.target,f.target);assert.equal(p.targetTree,f.tree);assert.ok(touched>0);
 }
});

test('exact message BOM/CRLF/EOF bytes and independent owned mutable output bodies',()=>{
 const f=fixture();
 for(const message of ['x','x\n','\ufeff正文\r\n\tEOF','x\r\n']){
  const m=Buffer.from(message),i=inputs(f,{message:m}),a=createVerifiedTagPlan(f.body,i),b=createVerifiedTagPlan(f.body,i);
  assert.deepEqual(a.object.body,expectedTag(f,i));assert.equal(a.message,message);assert.equal(a.messageBytes,m.length);
  m.fill(0);assert.deepEqual(a.object.body,b.object.body);a.object.body.fill(0);assert.notDeepEqual(a.object.body,b.object.body);assert.equal(b.object.oid,hash('tag',b.object.body));
 }
});

test('callbacks cannot mutate captured body, message, scalars or identity',()=>{
 const f=fixture(),message=Buffer.from('\ufefforiginal\r\nEOF'),tagger={...person},i=inputs(f,{message,tagger});
 const expected=expectedTag(f,i);let calls=0;
 i.signal={throwIfAborted(){calls++;f.body.fill(0);message.fill(0);tagger.name='evil';tagger.timestamp=0;i.target='b'.repeat(40);i.tag='evil';i.message='evil';i.objectFormat='sha256';}};
 const p=createVerifiedTagPlan(f.body,i);assert.ok(calls>2);assert.deepEqual(p.object.body,expected);assert.deepEqual(p.tagger,person);assert.equal(p.tag,'release/v1');assert.equal(p.target,f.target);
});

test('ID binds each tagger field, exact message, tag/ref, target commit and object format',()=>{
 const f=fixture(),base=plan(f),ids=new Set([base.id]);
 for(const change of [{name:'Other'},{email:'other@example.invalid'},{timestamp:1},{timezone:'-0000'}])ids.add(plan(f,{tagger:{...person,...change}}).id);
 for(const message of ['正文\n','正文\r\n','\ufeff正文'])ids.add(plan(f,{message}).id);
 ids.add(plan(f,{tag:'release/v2'}).id);ids.add(plan(fixture('sha1',[],Buffer.from('other commit'))).id);ids.add(plan(fixture('sha256')).id);
 assert.equal(ids.size,11);assert.equal(base.id,plan(f).id);
});

test('all capture validation precedes first cancellation callback',()=>{
 const f=fixture();let calls=0;const signal={throwIfAborted(){calls++;}};
 for(const extra of [{target:'bad'},{tag:'../bad'},{message:' '},{message:Buffer.from([255])},{message:'x-----BEGIN PGP SIGNATURE-----'},{message:'x'.repeat(65537)},{objectFormat:'sha512'},{tagger:{...person,name:'bad\nname'}},{tagger:{...person,timestamp:'1'}},{tagger:{...person,timezone:'+1460'}},{tagger:{...person,email:'x'.repeat(1025)}}])assert.throws(()=>plan(f,{...extra,signal}));
 assert.equal(calls,0);
});

test('native intrinsic pre-abort and cooperative signals match tag parser policy',()=>{
 const f=fixture(),controller=new AbortController(),reason=Error('stop');controller.abort(reason);
 Object.defineProperty(controller.signal,'aborted',{get(){throw Error('own native getter ran');}});
 Object.defineProperty(controller.signal,'throwIfAborted',{value(){throw Error('override ran');}});
 assert.throws(()=>plan(f,{signal:controller.signal}),e=>e===reason);
 assert.throws(()=>plan(f,{signal:{aborted:true}}),{name:'AbortError'});
 let calls=0;assert.throws(()=>plan(f,{signal:{throwIfAborted(){if(++calls===3)throw reason;}}}),e=>e===reason);assert.equal(calls,3);
 let getters=0;const getter={get aborted(){getters++;f.body.fill(0);return false;}};
 assert.throws(()=>plan(f,{signal:getter}),/own data/);assert.equal(getters,0);
 for(const signal of [null,[],{aborted:1},{throwIfAborted:1},{extra:1},Object.create({aborted:false}),{[Symbol()]:1}])assert.throws(()=>plan(f,{signal}));
 assert.doesNotThrow(()=>plan(f,{signal:nullRecord({aborted:false})}));
});

test('inclusive bounded raw commit and tag message; invalid raw input precedes inputs traps',()=>{
 const f=fixture(),header=f.body.subarray(0,f.body.indexOf('\n\n')+2);
 const raw=Buffer.concat([header,Buffer.alloc(2*1024*1024-header.length,0xff)]);
 assert.doesNotThrow(()=>createVerifiedTagPlan(raw,inputs(f,{target:hash('commit',raw),message:Buffer.alloc(65536,97)})));
 assert.doesNotThrow(()=>plan(f,{message:'é'.repeat(32768)}));
 for(const message of [Buffer.alloc(65537,97),'é'.repeat(32769),new Uint8Array([97]),'\ud800','a\0b'])assert.throws(()=>plan(f,{message}));
 let calls=0;const i=new Proxy({}, {getPrototypeOf(){calls++;throw Error('inputs read');}});
 for(const raw of [null,'body',new Uint8Array(f.body),Buffer.alloc(2*1024*1024+1)])assert.throws(()=>createVerifiedTagPlan(raw,i));assert.equal(calls,0);
});

test('temporary real Git stores actual target commit and independently agrees on tag hash',t=>{
 try{execFileSync('git',['--version'],{stdio:'ignore'});}catch{t.skip('git unavailable');return;}
 const dir=mkdtempSync(path.join(tmpdir(),'dsh-verified-tag-'));
 try{
  for(const format of ['sha1','sha256']){
   const cwd=path.join(dir,format);
   try{execFileSync('git',['init','--quiet','--object-format='+format,cwd],{stdio:'pipe'});}catch(e){if(format==='sha256'){t.diagnostic('Git SHA256 unavailable');continue;}throw e;}
   const git=(args,input)=>execFileSync('git',args,{cwd,input,encoding:'utf8'}).trim();
   const tree=git(['hash-object','-t','tree','-w','--stdin'],Buffer.alloc(0));
   const raw=Buffer.from('tree '+tree+'\nauthor '+identity(person)+'\ncommitter '+identity(person)+'\n\nactual target\n');
   const target=git(['hash-object','-t','commit','-w','--stdin'],raw),p=createVerifiedTagPlan(raw,{objectFormat:format,target,tag:'v1',tagger:person,message:'\ufefftag\r\nEOF'});
   assert.equal(target,hash('commit',raw,format));assert.equal(p.targetTree,tree);assert.equal(git(['cat-file','-t',target]),'commit');
   assert.equal(git(['hash-object','-t','tag','-w','--stdin'],p.object.body),p.object.oid);
   assert.deepEqual(execFileSync('git',['cat-file','tag',p.object.oid],{cwd}),p.object.body);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
