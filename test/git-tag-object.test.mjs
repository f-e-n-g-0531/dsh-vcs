import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {encodeGitTag,parseVerifiedGitTag} from '../src/git-tag-object.mjs';

const object='a'.repeat(40);
const person={name:'测试 Author',email:'test@example.invalid',timestamp:1700000000,timezone:'+0800'};
const input=(extra={})=>({object,tag:'release/v1',tagger:{...person},message:'正文',...extra});
const hash=(body,format='sha1')=>createHash(format).update(Buffer.from('tag '+body.length+'\0')).update(body).digest('hex');
const parse=body=>parseVerifiedGitTag(body,{oid:hash(body)});
const nullRecord=value=>Object.assign(Object.create(null),value);

test('literal canonical body and independent Git framing hashes for both formats',()=>{
 for(const objectFormat of ['sha1','sha256']){
  const target='a'.repeat(objectFormat==='sha1'?40:64),message='\ufeff正文\r\n\tEOF';
  const literal=Buffer.from('object '+target+'\ntype commit\ntag release/v1\ntagger 测试 Author <test@example.invalid> 1700000000 +0800\n\n'+message);
  const encoded=encodeGitTag(input({object:target,message}),{objectFormat});
  assert.deepEqual(encoded.body,literal);assert.equal(encoded.oid,hash(literal,objectFormat));
  const parsed=parseVerifiedGitTag(literal,{oid:encoded.oid,objectFormat});
  assert.deepEqual(parsed,{oid:encoded.oid,object:target,tag:'release/v1',tagger:person,message,messageBytes:Buffer.byteLength(message)});
  assert.ok(Object.isFrozen(parsed));assert.ok(Object.isFrozen(parsed.tagger));
  assert.ok(!Object.values(parsed).some(Buffer.isBuffer));
  assert.notEqual(encoded.oid,encodeGitTag(input({object:target,message:message+'\n'}),{objectFormat}).oid);
 }
});

test('messages preserve CRLF, BOM, tabs, EOF and forged headers without interpretation',()=>{
 for(const message of ['text','text\n','text\r\n','\ufefftext','x\tY\rZ','x\n\nobject '+'b'.repeat(40)+'\ntype tree\ntag forged\ntagger evil']){
  const encoded=encodeGitTag(input({message:Buffer.from(message)}));
  assert.equal(parse(encoded.body).message,message);assert.equal(parse(encoded.body).object,object);
 }
 const m=Buffer.from('owned'),a=encodeGitTag(input({message:m})),b=encodeGitTag(input({message:m}));
 m.fill(0);assert.deepEqual(a.body,b.body);a.body.fill(0);assert.notDeepEqual(a.body,b.body);
});

test('safe portable short names retain exact Unicode without normalization',()=>{
 for(const tag of ['v1','release/测试','é','e\u0301','a'.repeat(255),['a'.repeat(255),'b'.repeat(255),'c'.repeat(255),'d'.repeat(232)].join('/')]){
  const e=encodeGitTag(input({tag}));assert.equal(parse(e.body).tag,tag);
 }
 assert.notEqual(encodeGitTag(input({tag:'é'})).oid,encodeGitTag(input({tag:'e\u0301'})).oid);
 for(const tag of ['', '@','HEAD','head','HeAd','-v1','refs/tags/v1','refs/heads/v1','a//b','/a','a/','.a','a/.b','a..b','a@{b','a.lock','a.LoCk','a/b.','a/b ','a b','a~b','a^b','a:b','a?b','a*b','a[b','a\\b','a<b','a>b','a"b','a|b','con','a/PRN.txt','aux','nul','COM1.txt','lpt9','a\0b','a\nb','a\rb','a\tb','a\x7fb','a\u0085b','a\u200bb','\ud800','é'.repeat(128),'a'.repeat(256),Array(4).fill('a'.repeat(250)).join('/')])assert.throws(()=>encodeGitTag(input({tag})),undefined,JSON.stringify(tag));
 for(const tag of [null,Buffer.from('v1'),1,{},undefined])assert.throws(()=>encodeGitTag(input({tag})));
});

test('object IDs and formats are exact lowercase full nonzero widths; no caller type/signing options',()=>{
 for(const objectFormat of ['sha1','sha256']){
  const width=objectFormat==='sha1'?40:64,good='a'.repeat(width);
  for(const value of ['',good.slice(1),good+'a','A'.repeat(width),'g'.repeat(width),'0'.repeat(width),good.slice(1)+'\n',Buffer.from(good),null,undefined])assert.throws(()=>encodeGitTag(input({object:value}),{objectFormat}));
 }
 for(const objectFormat of ['SHA1','sha512','',null])assert.throws(()=>encodeGitTag(input(),{objectFormat}));
 for(const extra of [{type:'commit'},{gpgsig:'sig'},{body:Buffer.from('raw')},{objectFormat:'sha1'}])assert.throws(()=>encodeGitTag(input(extra)));
 for(const options of [{type:'commit'},{gpgsig:'sig'},{[Symbol()]:1}])assert.throws(()=>encodeGitTag(input(),options));
});

test('tagger identity matches commit bounds and rejects controls and coercion',()=>{
 for(const field of ['name','email']){
  for(const value of ['', '   ','x<y','x>y','x\ny','x\ry','x\ty','x\0y','x\x7fy','x\u0085y','x\u200by','x\u2028y','x\u2029y','\udfff','x'.repeat(1025),'é'.repeat(513),Buffer.from('x'),null,undefined,{}])assert.throws(()=>encodeGitTag(input({tagger:{...person,[field]:value}})));
  for(const value of ['x'.repeat(1024),'é'.repeat(512),' spaced '])assert.doesNotThrow(()=>parse(encodeGitTag(input({tagger:{...person,[field]:value}})).body));
 }
 for(const timestamp of [-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',null,undefined])assert.throws(()=>encodeGitTag(input({tagger:{...person,timestamp}})));
 for(const timezone of ['0800','+800','+08:00','+0060','+1401','-1460','+1500','Z','+0000\n',undefined])assert.throws(()=>encodeGitTag(input({tagger:{...person,timezone}})));
 for(const timezone of ['+0000','-0000','+1359','+1400','-1400'])for(const timestamp of [0,Number.MAX_SAFE_INTEGER])assert.doesNotThrow(()=>parse(encodeGitTag(input({tagger:{...person,timestamp,timezone}})).body));
});

test('message nonblank, UTF-8, Cc, signature and 64KiB bounds',()=>{
 for(const message of ['', ' \t\r\n','\ufeff','a\0b','a\x01b','a\x7fb','a\u0085b','\ud800',Buffer.from([0xff]),Buffer.from([0xc0,0xaf]),Buffer.from([0xef,0xbb]),new Uint8Array([97]),null,undefined,'x'.repeat(65537),'é'.repeat(32769),'x-----BEGIN PGP SIGNATURE-----y','x\n-----BEGIN PGP SIGNATURE-----\nabc'])assert.throws(()=>encodeGitTag(input({message})));
 for(const message of ['x'.repeat(65536),'é'.repeat(32768),Buffer.alloc(65536,97),'-----BEGIN PGP SIGNATURE----','-----END PGP SIGNATURE-----'])assert.doesNotThrow(()=>parse(encodeGitTag(input({message})).body));
});

test('exact plain/null own-data input, tagger and options records; getters never execute',()=>{
 assert.doesNotThrow(()=>encodeGitTag(nullRecord({...input(),tagger:nullRecord(person)}),nullRecord({})));
 let calls=0;
 for(const [base,invoke,keys] of [[input(),r=>encodeGitTag(r),['object','tag','tagger','message']], [person,r=>encodeGitTag(input({tagger:r})),Object.keys(person)], [{objectFormat:'sha1'},r=>encodeGitTag(input(),r),['objectFormat']]]){
  for(const key of keys){const r={...base};Object.defineProperty(r,key,{get(){calls++;throw Error('getter ran');}});assert.throws(()=>invoke(r));}
  for(const key of keys){const r={...base};delete r[key];if(base===person||base.object)assert.throws(()=>invoke(r));}
  for(const extra of [{extra:1},{[Symbol()]:1}])assert.throws(()=>invoke({...base,...extra}));
  assert.throws(()=>invoke(Object.create(base)));
  for(const r of [null,[],new Date(),new String('x')])assert.throws(()=>invoke(r));
 }
 assert.equal(calls,0);
 const r=input();Object.defineProperty(r,'tag',{value:r.tag,enumerable:false});assert.doesNotThrow(()=>encodeGitTag(r));
 const options=Object.defineProperty({},'objectFormat',{get(){calls++;return 'sha1';}});
 const bad=input({tagger:Object.defineProperty({...person},'name',{get(){calls++;return 'x';}})});
 assert.throws(()=>encodeGitTag(bad,options));assert.equal(calls,0);
});

test('parser strict options snapshot rejects accessor/inherited/extra/symbol fields without invoking getters',()=>{
 const e=encodeGitTag(input());let calls=0;
 for(const key of ['oid','objectFormat','signal']){
  const options={oid:e.oid};Object.defineProperty(options,key,{get(){calls++;e.body.fill(0);return e.oid;}});
  assert.throws(()=>parseVerifiedGitTag(e.body,options));
 }
 assert.equal(calls,0);assert.equal(parse(e.body).oid,e.oid);
 for(const options of [null,[],{},Object.create({oid:e.oid}),{oid:e.oid,extra:1},{oid:e.oid,[Symbol()]:1}])assert.throws(()=>parseVerifiedGitTag(e.body,options));
 assert.doesNotThrow(()=>parseVerifiedGitTag(e.body,nullRecord({oid:e.oid})));
 for(const bytes of ['body',new Uint8Array(e.body),null,Buffer.alloc(131073)])assert.throws(()=>parseVerifiedGitTag(bytes,{oid:e.oid}));
});

test('parser copies body and captures options before trusted signal callback mutation',()=>{
 const e=encodeGitTag(input()),body=Buffer.from(e.body),options={oid:e.oid,objectFormat:'sha1'};let calls=0;
 options.signal={throwIfAborted(){calls++;body.fill(0);options.oid='b'.repeat(40);options.objectFormat='bad';options.signal=null;}};
 const result=parseVerifiedGitTag(body,options);assert.equal(result.oid,e.oid);assert.equal(result.message,'正文');assert.ok(calls>=3);
 assert.throws(()=>parseVerifiedGitTag(body,{oid:e.oid}),/mismatch/);
 const ac=new AbortController();ac.abort();assert.throws(()=>parseVerifiedGitTag(e.body,{oid:e.oid,signal:ac.signal}),{name:'AbortError'});
 const reason=Error('custom reason');const custom=new AbortController();custom.abort(reason);assert.throws(()=>parseVerifiedGitTag(e.body,{oid:e.oid,signal:custom.signal}),e=>e===reason);
 let count=0;assert.throws(()=>parseVerifiedGitTag(e.body,{oid:e.oid,signal:{throwIfAborted(){if(++count===3)throw reason;}}}),e=>e===reason);
 assert.throws(()=>parseVerifiedGitTag(e.body,{oid:e.oid,signal:{aborted:true}}),{name:'AbortError'});
 for(const signal of [null,[],{aborted:'yes'},{throwIfAborted:1},{extra:1},Object.defineProperty({},'aborted',{get(){throw Error('must not run');}})])assert.throws(()=>parseVerifiedGitTag(e.body,{oid:e.oid,signal}));
 const active=new AbortController();Object.defineProperty(active.signal,'aborted',{get(){throw Error('override must not run');}});Object.defineProperty(active.signal,'throwIfAborted',{get(){throw Error('override must not run');}});
 assert.doesNotThrow(()=>parseVerifiedGitTag(e.body,{oid:e.oid,signal:active.signal}));
});

test('self-hashed malformed headers, noncanonical numbers, unsafe messages and tampering fail closed',()=>{
 const e=encodeGitTag(input()),text=e.body.toString();
 const bad=[text.replace('type commit','type tree'),text.replace('type commit','type tag'),text.replace('type commit','type commit\nencoding UTF-8'),text.replace('tag release/v1','tag release/v1\ngpgsig sig'),text.replace('tagger ',' tagger '),text.replace('tagger ','tagger\t'),text.replace('object '+object+'\ntype commit','type commit\nobject '+object),text.replace('\n\n','\n'),text.replace('\n\n','\r\n\r\n'),text.replace('1700000000','01700000000'),text.replace('1700000000','+1700000000'),text.replace('1700000000','9007199254740992'),text.replace('+0800','+1401'),text.replace('release/v1','HEAD'),text.replace('测试 Author','bad\u200bname'),text.replace('正文',''),text.replace('正文','\0'),text.replace('正文','-----BEGIN PGP SIGNATURE-----'),text+'\x7f'];
 for(const value of bad)assert.throws(()=>parse(Buffer.from(value)));
 const malformed=Buffer.concat([e.body.subarray(0,e.body.length-1),Buffer.from([0xff])]);assert.throws(()=>parse(malformed));
 const changed=Buffer.from(e.body);changed[changed.length-1]^=1;assert.throws(()=>parseVerifiedGitTag(changed,{oid:e.oid}),/mismatch/);
 for(const oid of ['0'.repeat(40),'A'.repeat(40),'a'.repeat(39),Buffer.from(e.oid)])assert.throws(()=>parseVerifiedGitTag(e.body,{oid}));
 assert.throws(()=>parseVerifiedGitTag(e.body,{oid:e.oid,objectFormat:'sha256'}));
 assert.throws(()=>parseVerifiedGitTag(Buffer.alloc(131072,97),{oid:hash(Buffer.alloc(131072,97))}));
});

for(const objectFormat of ['sha1','sha256'])test('real temporary Git '+objectFormat+' hash-object and cat-file raw-byte oracle',()=>{
 const root=mkdtempSync(path.join(tmpdir(),'dsh-tag-object-'));
 const run=(args,options={})=>execFileSync('git',args,{cwd:root,windowsHide:true,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'absent-config')},...options});
 try{
  run(['init','--quiet','--object-format='+objectFormat]);
  const target='a'.repeat(objectFormat==='sha1'?40:64);
  for(const message of ['message','\ufeff正文\r\n\tEOF','message\n','x\n\nobject forged\ntype tag']){
   const e=encodeGitTag(input({object:target,message}),{objectFormat});
   assert.equal(run(['hash-object','-t','tag','--stdin'],{input:e.body,encoding:'utf8'}).trim(),e.oid);
   assert.equal(run(['hash-object','-w','-t','tag','--stdin'],{input:e.body,encoding:'utf8'}).trim(),e.oid);
   assert.deepEqual(run(['cat-file','tag',e.oid]),e.body);
   assert.equal(parseVerifiedGitTag(run(['cat-file','tag',e.oid]),{oid:e.oid,objectFormat}).message,message);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
});
