import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBranchDeletePlan as plan} from '../src/branch-delete-plan.mjs';

const oid=(n,width=40)=>n.toString(16).padStart(width,'0');
const row=(n,parents=[],width=40)=>({oid:oid(n,width),parents:parents.map(n=>oid(n,width))});
function fixture(width=40){return {objectFormat:width===40?'sha1':'sha256',current:{ref:'refs/heads/main',oid:oid(3,width)},target:{ref:'refs/heads/topic',oid:oid(1,width)},commits:[row(3,[2],width),row(2,[1],width),row(1,[],width)]};}
const nullRecord=value=>Object.assign(Object.create(null),value);

for(const width of [40,64])test('chain and exact canonical ID width '+width,()=>{
 const input=fixture(width),result=plan(input);
 assert.deepEqual(result.proof,[oid(3,width),oid(2,width),oid(1,width)]);
 assert.equal(result.action,'branch-delete');assert.equal(result.merged,true);
 const canonical=[row(1,[],width),row(2,[1],width),row(3,[2],width)].map(r=>[r.oid,r.parents]);
 assert.equal(result.id,createHash('sha256').update(JSON.stringify(['dsh-branch-delete-plan-v1',input.objectFormat,[input.current.ref,input.current.oid],[input.target.ref,input.target.oid],canonical])).digest('hex'));
 assert.deepEqual(Object.keys(result),['id','action','objectFormat','current','target','merged','proof']);
 for(const value of [result,result.current,result.target,result.proof])assert.ok(Object.isFrozen(value));
 assert.throws(()=>result.proof.push(oid(8)),TypeError);
 input.commits[0].parents.length=0;input.current.ref='refs/heads/changed';assert.equal(result.current.ref,'refs/heads/main');
});
test('default object format and null-prototype records',()=>{
 const input=fixture();delete input.objectFormat;
 input.current=nullRecord(input.current);input.target=nullRecord(input.target);input.commits=input.commits.map(nullRecord);
 assert.equal(plan(nullRecord(input)).objectFormat,'sha1');
});
test('merge proof and ID ignore all row and parent permutations',()=>{
 const input=fixture();input.current.oid=oid(5);input.commits=[row(5,[4,3]),row(4,[1]),row(3,[2]),row(2,[1]),row(1)];
 const expected=plan(input);assert.deepEqual(expected.proof,[5,3,2,1].map(n=>oid(n)));
 input.commits.reverse();for(const r of input.commits)r.parents.reverse();assert.deepEqual(plan(input),expected);
});
test('proof backtracks past dead ends and shared ancestry',()=>{
 const input=fixture();input.current.oid=oid(6);input.target.oid=oid(4);
 input.commits=[row(6,[2,5]),row(2,[1]),row(1),row(5,[2,4]),row(4,[1])];
 assert.deepEqual(plan(input).proof,[6,5,4].map(n=>oid(n)));
});
test('identical tips need one row, including root',()=>{
 const input=fixture();input.current.oid=input.target.oid;input.commits=[row(1)];assert.deepEqual(plan(input).proof,[oid(1)]);
 input.commits=[];assert.throws(()=>plan(input),/Missing current or target/);
});
for(const sameTip of [false,true])test('current branch and case aliases always reject sameTip='+sameTip,()=>{
 const input=fixture();if(sameTip)input.current.oid=input.target.oid;
 for(const name of ['main','MAIN','Main']){input.target.ref='refs/heads/'+name;assert.throws(()=>plan(input),/current branch or case-insensitive alias/);}
});
test('closed unmerged graph is distinguished from missing rows',()=>{
 const input=fixture();input.commits=[row(3,[2]),row(2),row(1)];assert.throws(()=>plan(input),/not merged/);
 input.commits=[row(3,[2]),row(1)];assert.throws(()=>plan(input),/Missing parent/);
 input.commits=[row(2),row(1)];assert.throws(()=>plan(input),/Missing current or target/);
 input.commits=[row(3),row(2)];assert.throws(()=>plan(input),/Missing current or target/);
});
test('truncated target history and disconnected missing edges reject even with direct proof',()=>{
 const input=fixture();input.commits=[row(3,[1]),row(1,[8])];assert.throws(()=>plan(input),/closed/);
 input.commits=[row(3,[1]),row(1),row(9,[8])];assert.throws(()=>plan(input),/closed/);
});
for(const rows of [[row(3,[3]),row(1)],[row(3,[2]),row(2,[3]),row(1)],[row(3,[1]),row(1),row(7,[8]),row(8,[7])]])test('all supplied cycles reject '+JSON.stringify(rows),()=>{
 const input=fixture();input.commits=rows;assert.throws(()=>plan(input),/Cyclic/);
});
test('duplicates reject, including identical rows and parents',()=>{
 const input=fixture();input.commits.push(row(1));assert.throws(()=>plan(input),/Duplicate commit/);
 input.commits=fixture().commits;input.commits[0].parents.push(oid(2));assert.throws(()=>plan(input),/Duplicate parent/);
});
for(const name of ['', '@','HEAD','head','-bad','refs/x','a//b','.hidden','a/.b','a..b','a@{b','a.lock','a.LOCK','a.','a ','a b','a\nb','a\\b','a[b','a?b','a*b','a~b','a^b','a:b','a<b','a>b','a"b','a|b','CON','aux.txt','LPT1','a/COM9.log','a\u200db','\ud800','x'.repeat(256),'x/'.repeat(501)])test('reject unsafe portable name '+JSON.stringify(name),()=>{
 const input=fixture();input.target.ref='refs/heads/'+name;assert.throws(()=>plan(input),/portable/);
});
for(const name of ['feature/中文','com10','auxiliary','a+b','a@b','révision'])test('accept portable branch '+name,()=>{
 const input=fixture();input.target.ref='refs/heads/'+name;assert.equal(plan(input).target.ref,input.target.ref);
});
for(const ref of ['main','refs/tags/topic','refs/heads','REFS/heads/topic',null,4])test('reject non-full branch '+ref,()=>{
 const input=fixture();input.target.ref=ref;assert.throws(()=>plan(input),/Full refs/);
});
for(const value of ['', 'a'.repeat(39),'a'.repeat(41),'A'.repeat(40),'g'.repeat(40),'0'.repeat(40),4,null,{},'a'.repeat(64)])test('reject invalid OID '+JSON.stringify(value),()=>{
 for(const mutate of [x=>x.current.oid=value,x=>x.target.oid=value,x=>x.commits[0].oid=value,x=>x.commits[0].parents[0]=value]){
  const input=fixture();mutate(input);assert.throws(()=>plan(input),/object id/);
 }
});
for(const value of ['SHA1','sha512',null,{},false])test('reject format '+JSON.stringify(value),()=>{
 const input=fixture();input.objectFormat=value;assert.throws(()=>plan(input),/object format/);
});
for(const select of [x=>x,x=>x.current,x=>x.target,x=>x.commits[0]])test('strict record shape at '+select.toString(),()=>{
 for(const key of ['extra',Symbol('extra')]){const input=fixture();select(input)[key]=true;assert.throws(()=>plan(input),/Unsupported/);}
 const input=fixture();const object=select(input),key=Object.keys(object).find(key=>key!=='objectFormat');delete object[key];assert.throws(()=>plan(input),/Missing/);
 let reads=0;const withGetter=fixture();Object.defineProperty(select(withGetter),key,{get(){reads++;throw Error('getter executed');}});
 assert.throws(()=>plan(withGetter),/own data/);assert.equal(reads,0);
 const inherited=fixture();Object.setPrototypeOf(select(inherited),{});assert.throws(()=>plan(inherited),/record/);
});
for(const select of [x=>x.commits,x=>x.commits[0].parents])test('strict arrays at '+select.toString(),()=>{
 const hole=fixture();delete select(hole)[0];assert.throws(()=>plan(hole),/dense/);
 for(const key of ['extra',Symbol('extra')]){const input=fixture();select(input)[key]=true;assert.throws(()=>plan(input),/dense/);}
 const input=fixture();let reads=0;Object.defineProperty(select(input),'0',{get(){reads++;throw Error('array getter');}});assert.throws(()=>plan(input),/own data/);assert.equal(reads,0);
 const inherited=fixture();Object.setPrototypeOf(select(inherited),null);assert.throws(()=>plan(inherited),/array/);
});
test('accessor optional fields are not evaluated',()=>{
 for(const key of ['signal','objectFormat']){
  const input=fixture();let reads=0;Object.defineProperty(input,key,{get(){reads++;throw Error('getter');}});
  assert.throws(()=>plan(input),/own data/);assert.equal(reads,0);
 }
});
test('force, caller merged/proof and arbitrary write operations are unsupported',()=>{
 for(const key of ['force','merged','proof','apply','write']){const input=fixture();let writes=0;input[key]=()=>writes++;assert.throws(()=>plan(input),/Unsupported/);assert.equal(writes,0);}
});
test('limits checked before walking input arrays',()=>{
 const input=fixture();input.commits=new Array(10001);assert.throws(()=>plan(input),/commits limit/);
 input.commits=fixture().commits;input.commits[0].parents=new Array(17);assert.throws(()=>plan(input),/parents limit/);
});
test('16 unique parents accepted and exact 10000-node deep chain avoids recursion',()=>{
 const input=fixture();input.current.oid=oid(17);input.commits=Array.from({length:16},(_,i)=>row(i+1));input.commits.push(row(17,Array.from({length:16},(_,i)=>i+1)));assert.deepEqual(plan(input).proof,[oid(17),oid(1)]);
 input.current.oid=oid(10000);input.commits=Array.from({length:10000},(_,i)=>row(i+1,i?[i]:[]));
 const result=plan(input);assert.equal(result.proof.length,10000);assert.equal(result.proof[0],oid(10000));assert.equal(result.proof.at(-1),oid(1));
 input.commits.reverse();assert.equal(plan(input).id,result.id);
});
test('cancel before start and during traversal',()=>{
 const input=fixture();input.signal=AbortSignal.abort();assert.throws(()=>plan(input),{name:'AbortError'});
 let checks=0;input.signal={throwIfAborted(){if(++checks===4){const error=Error('cancel');error.name='AbortError';throw error;}}};assert.throws(()=>plan(input),{name:'AbortError'});assert.equal(checks,4);
 input.signal={aborted:true};assert.throws(()=>plan(input),{name:'AbortError'});
});
test('signal access runs only after graph and scalars captured',()=>{
 const input=fixture(),expected=plan(input);let calls=0;
 input.signal={get throwIfAborted(){if(++calls===1){input.current.oid='bad';input.target.ref='bad';input.commits[0].parents[0]='bad';input.commits.length=0;}return ()=>{};}};
 assert.deepEqual(plan(input),expected);assert.ok(calls>1);
});
test('malformed input rejects before any signal callback',()=>{
 const input=fixture();let calls=0;input.signal={get aborted(){calls++;return false;},throwIfAborted(){calls++;}};
 input.commits[0].parents[0]='bad';assert.throws(()=>plan(input),/object id/);assert.equal(calls,0);
});
test('IDs bind refs, tips, format and entire graph, not only proof subset',()=>{
 const input=fixture(),id=plan(input).id;
 input.target.ref='refs/heads/other';assert.notEqual(plan(input).id,id);input.target.ref='refs/heads/topic';
 input.current.ref='refs/heads/other';assert.notEqual(plan(input).id,id);input.current.ref='refs/heads/main';
 input.target.oid=oid(2);assert.notEqual(plan(input).id,id);input.target.oid=oid(1);
 input.commits.push(row(9));assert.notEqual(plan(input).id,id);
 assert.notEqual(plan(fixture(64)).id,id);
});
test('input graph/proof remains only unauthenticated claims, never an apply capability',()=>{
 const input=fixture(),result=plan(input);
 assert.deepEqual(Object.keys(result).filter(k=>typeof result[k]==='function'),[]);
 assert.equal(Object.hasOwn(result,'force'),false);assert.equal(Object.hasOwn(result,'commits'),false);
 const forged={...input,commits:[row(3,[1]),row(1)]};assert.equal(plan(forged).merged,true);
 // No object bytes are supplied to authenticate this invented edge; callers must
 // never treat either this plan or its proof subset as repository authorization.
 assert.notEqual(plan(forged).id,result.id);
});
