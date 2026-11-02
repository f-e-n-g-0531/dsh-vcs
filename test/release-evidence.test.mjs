import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {readFile} from 'node:fs/promises';
import {releaseRequest,selectEvidenceRuns,validateReleaseEvidence,candidatePackage,digest,MATRIX} from '../scripts/release-evidence.mjs';
import {SUPPORTED_HOSTS} from '../scripts/host-compat-policy.mjs';
const request=releaseRequest({tag:'v1.2.3',sha:'a'.repeat(40),repository:'owner/repo'});
function archive(version='1.2.3'){
 const body=Buffer.from(JSON.stringify({name:'@feng0531/dsh-vcs',version})),h=Buffer.alloc(512);h.write('package/package.json');h.write(body.length.toString(8).padStart(11,'0'),124);h.write('0',156);return gzipSync(Buffer.concat([h,body,Buffer.alloc((512-body.length%512)%512+1024)]));
}
const run=(id,event)=>({id,run_attempt:2,event,head_sha:request.sha,head_branch:request.tag,head_repository:{full_name:request.repository},status:'completed',conclusion:'success'});
const runs=()=>({ci:[run(10,'push')],chrome:[run(11,'workflow_dispatch')],compat:[run(12,'workflow_dispatch')]});
function evidence(){const selected=selectEvidenceRuns(request,runs()),bytes=archive(),binding=run=>({schema:1,ref:'refs/tags/'+request.tag,refType:'tag',tag:request.tag,sha:request.sha,runId:run.id,runAttempt:run.attempt});return {selected,data:{candidates:MATRIX.map(matrix=>({bytes,metadata:{...binding(selected.ci),matrix,version:request.version,filename:'candidate.tgz',sha256:digest(bytes),size:bytes.length,tests:{tests:2,pass:2,fail:0,cancelled:0,skipped:0,todo:0},tools:{node:'22',git:'2',svn:'1',svnadmin:'1',openssl:'3'}}})),chrome:{...binding(selected.chrome),candidateSha256:digest(bytes),ciRun:selected.ci.id,ciAttempt:selected.ci.attempt,tools:{node:'22',chrome:'Chrome 130'},passed:true},compat:SUPPORTED_HOSTS.map(hostVersion=>({...binding(selected.compat),candidateSha256:digest(bytes),ciRun:selected.ci.id,ciAttempt:selected.ci.attempt,hostVersion,tools:{node:'22',host:hostVersion},pluginVersion:request.version,passed:true,contracts:['peer-gate','registration','authentication','session','assets','rpc','lazy-client','dispose-reload']}))}};}
test('release request defaults both and validates exact tag SHA and channel',()=>{
 assert.equal(request.channel,'both');assert.equal(releaseRequest({...request,channel:'github-only'}).channel,'github-only');
 for(const patch of [{tag:'v01.2.3'},{tag:'v1x2x3'},{tag:'v1.2.3-rc.1'},{sha:'HEAD'},{repository:'../x'},{channel:'npm'}])assert.throws(()=>releaseRequest({...request,...patch}));
});
test('evidence requires latest same-tag SHA repository event and complete successful attempt',()=>{
 assert.equal(selectEvidenceRuns(request,runs()).chrome.id,11);
 for(const key of ['ci','chrome','compat'])for(const patch of [{head_sha:'b'.repeat(40)},{head_branch:'main'},{head_repository:{full_name:'fork/repo'}},{event:'pull_request'},{status:'in_progress'},{conclusion:'failure'},{run_attempt:0}]){const r=runs();r[key][0]={...r[key][0],...patch};assert.throws(()=>selectEvidenceRuns(request,r));}
 const r=runs();r.chrome.push({...r.chrome[0],id:20,conclusion:'failure'});assert.throws(()=>selectEvidenceRuns(request,r),/Latest Chrome/);
});
test('all four candidate bytes and current Chrome and four host reports produce exact candidate result',()=>{
 const {selected,data}=evidence(),result=validateReleaseEvidence(request,selected,data);assert.equal(result.sha256,digest(data.candidates[0].bytes));assert.equal(result.filename,'candidate.tgz');assert.deepEqual(result.hosts,SUPPORTED_HOSTS);
 assert.equal(candidatePackage(archive()).version,'1.2.3');
});
test('release gate fails closed for missing stale mismatched or skipped evidence before publication',()=>{
 const mutations=[d=>delete d.chrome.candidateSha256,d=>d.chrome.candidateSha256='b'.repeat(64),d=>d.chrome.ciRun=99,d=>d.chrome.ciAttempt=1,d=>delete d.compat[0].candidateSha256,d=>d.compat[0].candidateSha256='c'.repeat(64),d=>d.compat[0].ciRun=99,d=>d.compat[0].ciAttempt=1,d=>d.chrome.ref='refs/heads/'+request.tag,d=>d.chrome.refType='branch',d=>d.candidates[0].metadata.ref='refs/heads/'+request.tag,d=>d.compat[0].refType='branch',d=>d.candidates.pop(),d=>d.candidates[1].metadata.matrix=MATRIX[0],d=>d.candidates[0].metadata.sha='b'.repeat(40),d=>d.candidates[0].metadata.runAttempt=1,d=>d.candidates[0].metadata.sha256='f'.repeat(64),d=>d.candidates[0].metadata.filename='../x.tgz',d=>d.candidates[0].metadata.version='1.2.2',d=>d.candidates[0].metadata.tests.skipped=1,d=>d.candidates[0].metadata.tests.todo=1,d=>d.candidates[0].metadata.tools={},d=>d.chrome.passed=false,d=>d.chrome.runId=1,d=>d.compat.pop(),d=>{d.compat=d.compat.filter(row=>row.hostVersion!=='0.2.1-rc.5');},d=>d.compat[1].hostVersion=SUPPORTED_HOSTS[0],d=>d.compat[0].contracts=[],d=>d.compat[0].pluginVersion='1.2.2',d=>{d.candidates[1].bytes=archive('1.2.2');d.candidates[1].metadata.sha256=digest(d.candidates[1].bytes);d.candidates[1].metadata.size=d.candidates[1].bytes.length;}];
 for(const mutate of mutations){const {selected,data}=evidence();mutate(data);assert.throws(()=>validateReleaseEvidence(request,selected,data));}
});
test('old Chrome and host reports cannot authenticate a different four-way matching candidate',()=>{
 const {selected,data}=evidence(),bytes=archive('1.2.3');
 // A harmless trailing gzip member changes actual archive bytes, not tag/version.
 const changed=Buffer.concat([bytes,gzipSync(Buffer.alloc(0))]);
 for(const row of data.candidates){row.bytes=changed;row.metadata.sha256=digest(changed);row.metadata.size=changed.length;}
 assert.throws(()=>validateReleaseEvidence(request,selected,data),/candidate hash mismatch/);
});
test('workflow only publishes verified candidate and isolates every npm action behind both channel',async()=>{
 const source=await readFile(new URL('../.github/workflows/release.yml',import.meta.url),'utf8');
 assert.ok(source.includes('default: both'));assert.ok(source.includes('node scripts/release-preflight.mjs verify evidence'));assert.ok(source.includes('steps.evidence.outputs.filename'));assert.ok(!source.includes('npm pack --'));assert.ok(!source.includes('npm ci'));
 for(const name of ['Configure npm credentials for explicit both channel only','Publish exact tarball to npm','Verify public npm artifact before GitHub release'])assert.ok(source.split('      - name: '+name)[1].split('      - ')[0].includes("if: inputs.channel == 'both'"));
 assert.ok(source.includes('(cd verified && sha256sum --check SHA256SUMS.txt)'));assert.ok(source.includes('verified/SHA256SUMS.txt verified/release-evidence.json'));
 for(const name of ['layout','host-compat']){const yml=await readFile(new URL('../.github/workflows/'+name+'.yml',import.meta.url),'utf8');assert.ok(yml.includes('node scripts/release-preflight.mjs consume ci-evidence'));assert.ok(yml.includes('npm ci --include=dev --ignore-scripts'));assert.ok(!yml.includes('npm run build'));}
 for(const workflow of ['ci','layout','host-compat','host-fixtures','release']){const yml=await readFile(new URL('../.github/workflows/'+workflow+'.yml',import.meta.url),'utf8');assert.ok(!yml.includes('pull_request:'));if(workflow!=='ci')assert.ok(!yml.includes('  push:'));}
});
test('authored workflow and release sources contain no forbidden controls and expressions remain literal',async()=>{
 const files=['.github/workflows/ci.yml','.github/workflows/layout.yml','.github/workflows/release.yml','.github/workflows/host-compat.yml','.github/workflows/host-fixtures.yml','scripts/release-evidence.mjs','scripts/release-preflight.mjs','scripts/release-host-fixture.mjs','scripts/test-host-compat.mjs','scripts/host-compat-policy.mjs','scripts/test-preflight.mjs','scripts/run-release-tests.mjs','scripts/verify-test-report.mjs'];
 for(const file of files){const source=await readFile(new URL('../'+file,import.meta.url),'utf8');for(const c of source)assert.ok(c.charCodeAt(0)>=32||[9,10,13].includes(c.charCodeAt(0)),file+' has forbidden ASCII control');}
 const source=await readFile(new URL('../.github/workflows/release.yml',import.meta.url),'utf8');
 for(const expression of ['inputs.tag','inputs.channel','steps.runs.outputs.ci_run','steps.runs.outputs.chrome_run','steps.runs.outputs.compat_run'])assert.ok(source.includes('$'+'{{ '+expression+' }}'),'Missing literal expression '+expression);
});
