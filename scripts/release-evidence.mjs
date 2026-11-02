import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {PACKAGE_FILES} from './package-contract.mjs';
import {SUPPORTED_HOSTS} from './host-compat-policy.mjs';
export const MATRIX = Object.freeze(['ubuntu-latest-node-22','ubuntu-latest-node-24','windows-latest-node-22','windows-latest-node-24']);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function releaseRequest({tag,sha,channel='both',repository}) {
  assert.match(tag??'', /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/,'Invalid release tag');
  assert.match(sha??'', /^[a-f0-9]{40}$/,'Invalid release SHA');
  assert.ok(['both','github-only'].includes(channel),'Invalid release channel');
  assert.match(repository??'', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/,'Invalid repository');
  assert.ok(repository.split('/').every(part=>part!=='.'&&part!=='..'),'Invalid repository component');
  return {tag,sha,channel,repository,version:tag.slice(1)};
}
export function selectEvidenceRuns(request, {ci,chrome,compat}) {
  const choose=selectEvidenceRun;
  return {ci:choose(request,ci,'push','CI'),chrome:choose(request,chrome,'workflow_dispatch','Chrome'),compat:choose(request,compat,'workflow_dispatch','compatibility')};
}
export function selectEvidenceRun(request,runs,event='push',label='CI'){
    assert.ok(Array.isArray(runs), 'Missing '+label+' workflow runs');
    const matches=runs.filter(r=>r.head_sha===request.sha&&r.head_branch===request.tag&&r.event===event&&r.head_repository?.full_name===request.repository).sort((a,b)=>b.id-a.id);
    assert.ok(matches.length, 'Missing exact tag/SHA '+label+' run');
    const run=matches[0];
    assert.equal(run.status,'completed',label+' must complete');
    assert.equal(run.conclusion,'success','Latest '+label+' run must succeed');
    assert.ok(Number.isSafeInteger(run.id)&&run.id>0&&Number.isSafeInteger(run.run_attempt)&&run.run_attempt>0,'Invalid run identity');
    return {id:run.id,attempt:run.run_attempt};
}

export function candidateEntries(bytes) {
  assert.ok(bytes.length>0&&bytes.length<=64*1024*1024,'Invalid candidate size');
  const tar=gunzipSync(bytes,{maxOutputLength:128*1024*1024}),entries=[],names=new Set();
  for(let offset=0;offset+512<=tar.length;){
    const h=tar.subarray(offset,offset+512);if(h.every(b=>b===0))break;
    const str=(a,b)=>h.subarray(a,b).toString('utf8').replace(/\0.*$/s,'');
    const name=(str(345,500)?str(345,500)+'/':'')+str(0,100);
    const raw=str(124,136).trim();assert.match(raw,/^[0-7]+$/,'Invalid tar size');
    const size=parseInt(raw,8);assert.ok(Number.isSafeInteger(size)&&size>=0&&offset+512+size<=tar.length,'Truncated tar');
    const member=name.endsWith('/')?name.slice(0,-1):name;
    assert.ok((member==='package'||member.startsWith('package/'))&&!member.includes('\\')&&!member.includes(':')&&member.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Unsafe candidate member');
    assert.ok(!names.has(member),'Duplicate candidate member');names.add(member);
    const type=str(156,157);assert.ok(['0','','5'].includes(type),'Candidate links and special members forbidden');
    if(type!=='5'){assert.ok(PACKAGE_FILES.includes(member.slice(8))||/^locale[/][a-zA-Z0-9_-]+[.]json$/.test(member.slice(8)),'Unexpected candidate member');entries.push({name:member.slice(8),bytes:tar.subarray(offset+512,offset+512+size)});}
    offset+=512+Math.ceil(size/512)*512;
  }
  return entries;
}
export function candidatePackage(bytes){
 const entry=candidateEntries(bytes).find(row=>row.name==='package.json');assert.ok(entry&&entry.bytes.length<=65536,'Candidate manifest missing or oversized');
 const manifest=JSON.parse(entry.bytes.toString('utf8'));assert.equal(manifest.name,'@feng0531/dsh-vcs','Unexpected candidate package');return manifest;
}
export async function verifyConsumedCandidate(receiptFile,root=process.cwd()){
 const receipt=JSON.parse(await readFile(receiptFile,'utf8'));
 assert.match(receipt.candidateSha256??'',/^[a-f0-9]{64}$/,'Missing consumed candidate hash');
 assert.ok(Number.isSafeInteger(receipt.ciRun)&&receipt.ciRun>0&&Number.isSafeInteger(receipt.ciAttempt)&&receipt.ciAttempt>0,'Missing consumed CI identity');
 const archive=await readFile(receipt.archive);assert.equal(digest(archive),receipt.candidateSha256,'Consumed archive changed');candidatePackage(archive);
 for(const entry of candidateEntries(archive)){const file=path.join(root,entry.name);assert.ok((await lstat(file)).isFile(),'Consumed candidate file is not regular: '+entry.name);assert.equal(digest(await readFile(file)),digest(entry.bytes),'Consumed candidate file changed: '+entry.name);}
 return {candidateSha256:receipt.candidateSha256,ciRun:receipt.ciRun,ciAttempt:receipt.ciAttempt};
}
export function validateCandidates(request,ci,candidates){
 const selection={ci,chrome:{id:1,attempt:1},compat:{id:1,attempt:1}};
 return validateReleaseEvidence(request,selection,{candidates},true);
}

export function validateReleaseEvidence(request, selection, {candidates,chrome,compat}, candidatesOnly=false) {
  const bind=(row,run,label)=>{
    assert.equal(row?.schema,1,label+' schema');assert.equal(row.ref,'refs/tags/'+request.tag,label+' tag ref');assert.equal(row.refType,'tag',label+' ref type');assert.equal(row.tag,request.tag,label+' tag');assert.equal(row.sha,request.sha,label+' SHA');
    assert.equal(String(row.runId),String(run.id),label+' run');assert.equal(Number(row.runAttempt),run.attempt,label+' attempt');
  };
  assert.equal(candidates?.length,4,'Exactly four matrix candidates required');
  const seen=new Set();let expected;
  for(const {metadata,bytes} of candidates){
    bind(metadata,selection.ci,'candidate');assert.ok(MATRIX.includes(metadata.matrix)&&!seen.has(metadata.matrix),'Duplicate or unknown matrix');seen.add(metadata.matrix);
    assert.equal(metadata.version,request.version,'Candidate version');assert.match(metadata.filename??'',/^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/,'Unsafe candidate filename');
    const hash=digest(bytes);assert.equal(metadata.sha256,hash,'Candidate hash');assert.equal(metadata.size,bytes.length,'Candidate size');
    assert.equal(candidatePackage(bytes).version,request.version,'Embedded package version');
    const tests=metadata.tests;assert.ok(tests&&Number.isSafeInteger(tests.tests)&&tests.tests>0,'Missing test report');
    assert.equal(tests.pass,tests.tests,'Tests incomplete');for(const key of ['fail','cancelled','skipped','todo'])assert.equal(tests[key],0,'Release tests must have zero '+key);
    assert.ok(metadata.tools?.node&&metadata.tools?.git&&metadata.tools?.svn&&metadata.tools?.svnadmin&&metadata.tools?.openssl,'Missing tool preflight');
    if(expected){assert.equal(hash,expected.sha256,'Matrix candidate bytes differ');assert.equal(metadata.filename,expected.filename,'Matrix filename differs');}
    else expected={sha256:hash,size:bytes.length,filename:metadata.filename};
  }
  if(candidatesOnly)return {...expected,ciRun:selection.ci.id,ciAttempt:selection.ci.attempt};
  const candidateBind=row=>{assert.equal(row.candidateSha256,expected.sha256,'Evidence candidate hash mismatch');assert.equal(row.ciRun,selection.ci.id,'Evidence CI run mismatch');assert.equal(row.ciAttempt,selection.ci.attempt,'Evidence CI attempt mismatch');};
  candidateBind(chrome);
  bind(chrome,selection.chrome,'Chrome');assert.equal(chrome.passed,true,'Chrome evidence failed');assert.ok(chrome.tools?.node&&chrome.tools?.chrome,'Missing Chrome tool versions');
  assert.equal(compat?.length,SUPPORTED_HOSTS.length,'Missing exact host compatibility evidence');const hosts=new Set();
  for(const row of compat){candidateBind(row);bind(row,selection.compat,'compatibility');assert.ok(SUPPORTED_HOSTS.includes(row.hostVersion)&&!hosts.has(row.hostVersion),'Duplicate or unsupported host');hosts.add(row.hostVersion);assert.equal(row.pluginVersion,request.version,'Compatibility plugin version');assert.equal(row.passed,true,'Compatibility failed');assert.ok(row.tools?.node&&row.tools?.host===row.hostVersion,'Missing compatibility tool versions');
    for(const name of ['peer-gate','registration','authentication','session','assets','rpc','lazy-client','dispose-reload'])assert.ok(row.contracts?.includes(name),'Missing host contract '+name);
  }
  return {...request,...expected,runs:selection,hosts:[...hosts]};
}
