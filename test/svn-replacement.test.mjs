import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSvnRuntime} from '../src/svn-runtime.mjs';
import {createSvnDavLogTransport} from '../src/svn-dav-log-transport.mjs';
import {validateSvnCommand} from '../src/svn-command-gate.mjs';
import {parseSvnNodeKind,parseSvnDavNodeKind} from '../src/svn-node-kind.mjs';
const identity={cwd:'/wc',root:'https://example.test/repo',scope:'/',uuid:'d524e65f-a581-4edd-8084-716aaa8cf531'},address={sessionId:'s',repositoryId:'r'},target=identity.root+'/file.txt';
const info=kind=>'<info><entry kind="'+kind+'" revision="1"><url>'+target+'</url><repository><root>'+identity.root+'</root><uuid>'+identity.uuid+'</uuid></repository></entry></info>';
const resource=(kind,href='/repo/!svn/bc/1/file.txt')=>'<D:multistatus xmlns:D="DAV:"><D:response><D:href>'+href+'</D:href><D:propstat><D:prop><D:resourcetype>'+(kind==='dir'?'<D:collection/>':'')+'</D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>';
const fixture=n=>readFileSync(new URL('./fixtures/svn-dav-'+n+'.xml',import.meta.url),'utf8');
async function select(runtime){const offer=await runtime.describe(address),{token}=await runtime.approve(address,{offer:offer.offer,explicit:true}),params={token,snapshot:'2',revision:'2'},detail=await runtime.detail(address,params);return {...params,id:detail.changes[0].id};}
for(const kind of ['dir','file'])test('CLI R confirms historical '+kind+' before content',async()=>{
 const calls=[];const runtime=createSvnRuntime({resolveIdentity:async()=>identity,transport:async plan=>{calls.push(plan.args);const op=plan.args[0];if(op==='log')return '<log><logentry revision="2"><paths><path action="R" kind="file">/file.txt</path></paths></logentry></log>';if(op==='info')return info(kind);if(op==='proplist')return '<properties/>';return Buffer.from(plan.args.includes('1')?'before':'after');}});
 const result=await runtime.compare(address,await select(runtime));
 assert.equal(result.left.text,kind==='dir'?'':'before');assert.equal(result.left.absent,kind==='dir'?true:undefined);assert.equal(result.right.text,'after');
 assert.deepEqual(calls.filter(args=>args[0]==='info'),[['info','--xml','--non-interactive','--no-auth-cache','-r','1','--',target+'@1']]);
 assert.deepEqual(calls.filter(args=>args[0]==='cat').map(args=>args[4]),kind==='dir'?['2']:['1','2']);
});
for(const kind of ['dir','file'])test('DAV R confirms '+kind+' by baseline depth zero resource type without directory GET',async()=>{
 const calls=[];const runtime=createSvnRuntime({transportFormat:'dav',resolveIdentity:async()=>identity,transport:createSvnDavLogTransport({request:async(url,options)=>{
  calls.push({url,...options});if(options.method==='REPORT')return Buffer.from(fixture('detail').replaceAll('modified-path','replaced-path'));
  if(options.label)return Buffer.from(fixture('baseline').replaceAll('/bln/0','/bln/'+options.label).replaceAll('/bc/0/','/bc/'+options.label+'/').replace('<lp1:version-name>0','<lp1:version-name>'+options.label));
  if(url.endsWith('/repo/'))return Buffer.from(fixture('discovery'));
  if(options.body?.includes('resourcetype'))return Buffer.from(resource(kind,'/repo/!svn/bc/1/file.txt'+(kind==='dir'?'/':'')));
  if(options.method==='PROPFIND')return Buffer.from(fixture('propnames').replace('/bc/2/',url.includes('/bc/1/')?'/bc/1/':'/bc/2/'));
  return Buffer.from(url.includes('/bc/1/')?'before':'after');
 }})});const result=await runtime.compare(address,await select(runtime));
 assert.equal(result.left.text,kind==='dir'?'':'before');assert.equal(result.right.text,'after');
 const probes=calls.filter(call=>call.body?.includes('resourcetype'));assert.equal(probes.length,1);assert.equal(probes[0].depth,0);assert.equal(probes[0].url,identity.root+'/!svn/bc/1/file.txt');
 assert.deepEqual(calls.filter(call=>call.method==='GET').map(call=>call.url),kind==='dir'?[identity.root+'/!svn/bc/2/file.txt']:[identity.root+'/!svn/bc/1/file.txt',identity.root+'/!svn/bc/2/file.txt']);
});
test('kind parser binds URL revision root UUID and rejects ambiguous or unavailable evidence',()=>{
 const options={...identity,target,revision:'1'};assert.equal(parseSvnNodeKind(info('file'),options),'file');
 for(const xml of [info('unknown'),info('file').replace('revision="1"','revision="2"'),info('file').replace(target,target+'-other'),info('file').replace(identity.uuid,'other'),info('file').replace('<root>'+identity.root,'<root>'+identity.root+'-other'),info('file').replace('</info>',info('dir').slice(6))])assert.throws(()=>parseSvnNodeKind(xml,options));
 const davOptions={root:identity.root,target:identity.root+'/!svn/bc/1/file.txt'};assert.equal(parseSvnDavNodeKind(resource('dir'),davOptions),'dir');
 for(const xml of [resource('file').replace('200 OK','404 Not Found'),resource('file').replace('file.txt','other.txt'),resource('file').replace('<D:resourcetype></D:resourcetype>',''),resource('file').replace('<D:resourcetype>','<D:resourcetype><D:collection/><D:unknown/>')])assert.throws(()=>parseSvnDavNodeKind(xml,davOptions));
});
test('node kind XML rejects oversized entities duplicate responses and wrong namespaces',()=>{
 const options={...identity,target,revision:'1'},davOptions={root:identity.root,target:identity.root+'/!svn/bc/1/file.txt'};
 assert.throws(()=>parseSvnNodeKind(' '.repeat(2097153),options));
 assert.throws(()=>parseSvnNodeKind('<!DOCTYPE info [<!ENTITY x "file">]>'+info('file'),options));
 const wire=resource('file');
 for(const xml of [' '.repeat(2097153),wire.replace('xmlns:D="DAV:"','xmlns:D="urn:not-dav"'),wire.replace('</D:multistatus>',wire.slice(wire.indexOf('<D:response>'))),wire.replace('<D:resourcetype>','<D:resourcetype/><D:resourcetype>')])assert.throws(()=>parseSvnDavNodeKind(xml,davOptions));
});
test('info gate accepts only exact numeric scoped fixed-revision shape',()=>{
 const args=['info','--xml','--non-interactive','--no-auth-cache','-r','1','--',target+'@1'];assert.deepEqual(validateSvnCommand({args},identity).args,args);
 for(const bad of [[...args,'--recursive'],args.map(v=>v==='1'?'2':v),args.map(v=>v===target+'@1'?target+'@HEAD':v),args.map(v=>v==='--no-auth-cache'?'--username':v)])assert.throws(()=>validateSvnCommand({args:bad},identity));
 assert.throws(()=>validateSvnCommand({args},{...identity,scope:'/elsewhere'}));
});
test('failed or revoked historical confirmation cannot fall back to cat',async()=>{
 for(const mode of ['invalid','revoked']){const calls=[];let runtime;runtime=createSvnRuntime({resolveIdentity:async()=>identity,transport:async plan=>{calls.push(plan.args[0]);if(plan.args[0]==='log')return '<log><logentry revision="2"><paths><path action="R" kind="file">/file.txt</path></paths></logentry></log>';if(mode==='revoked')runtime.revokeSession('s');return mode==='invalid'?info('unknown'):info('file');}});await assert.rejects(runtime.compare(address,await select(runtime)));assert.equal(calls.includes('cat'),false);assert.equal(calls.includes('proplist'),false);}
});
