import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,lstat} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import path from 'node:path';
import {releaseRequest,selectEvidenceRuns,validateReleaseEvidence,candidatePackage,candidateEntries,validateCandidates,selectEvidenceRun,verifyConsumedCandidate,digest,MATRIX} from './release-evidence.mjs';
import {SUPPORTED_HOSTS} from './host-compat-policy.mjs';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const env=process.env;
const tagRef=()=>{assert.equal(env.GITHUB_REF_TYPE,'tag','Evidence must originate from a tag');assert.equal(env.GITHUB_REF,'refs/tags/'+env.RELEASE_TAG,'Evidence ref must match release tag');return {ref:env.GITHUB_REF,refType:env.GITHUB_REF_TYPE};};
const request=()=>releaseRequest({tag:env.RELEASE_TAG,sha:env.RELEASE_SHA,channel:env.RELEASE_CHANNEL||'both',repository:env.GITHUB_REPOSITORY||env.GH_REPO});
const output=(key,value)=>{assert.ok(!String(value).includes(String.fromCharCode(10)));if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,key+'='+value+String.fromCharCode(10));};
const writeJson=async(p,value)=>writeFile(p,JSON.stringify(value,null,2)+String.fromCharCode(10));
const candidatesAt=async dir=>Promise.all(MATRIX.map(async matrix=>{const folder=path.join(dir,'candidates',matrix),metadata=await json(path.join(folder,'candidate.json'));assert.match(metadata.filename??'',/^[A-Za-z0-9][A-Za-z0-9._-]*[.]tgz$/);const file=path.join(folder,metadata.filename);assert.ok((await lstat(file)).isFile(),'Candidate must be a regular file');return {metadata,bytes:await readFile(file),file};}));
const [command,arg,extra]=process.argv.slice(2);
if(command==='candidate'){
  const req=request();assert.ok(MATRIX.includes(extra),'Unknown matrix');
  assert.equal(path.basename(arg),arg,'Candidate must be a basename');
  const bytes=await readFile(arg),pkg=candidatePackage(bytes);assert.equal(pkg.version,req.version);
  await mkdir('candidate',{recursive:true});await copyFile(arg,path.join('candidate',arg));
  await writeJson('candidate/candidate.json',{schema:1,...tagRef(),tag:req.tag,sha:req.sha,version:pkg.version,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,matrix:extra,filename:arg,sha256:digest(bytes),size:bytes.length,tests:await json('test-results/test-summary.json'),tools:await json('test-results/tools.json')});
}else if(command==='chrome'){
  const req=request(),consumed=await verifyConsumedCandidate(env.DSH_CANDIDATE_RECEIPT||'consumed-candidate.json');await writeJson('test-results/chrome.json',{schema:1,...consumed,...tagRef(),tag:req.tag,sha:req.sha,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,tools:await json('test-results/browser-tools.json'),passed:true});
}else if(command==='select-ci'){
 const req=request(),dir=arg||'.',ci=selectEvidenceRun(req,(await json(path.join(dir,'ci.json'))).workflow_runs);
 await writeJson(path.join(dir,'ci-selection.json'),{request:req,ci});output('ci_run',ci.id);output('ci_attempt',ci.attempt);
}else if(command==='consume'){
 const dir=arg||'.',{request:req,ci}=await json(path.join(dir,'ci-selection.json'));assert.deepEqual(req,request(),'Candidate context changed');tagRef();
 const candidates=await candidatesAt(dir),candidate=validateCandidates(req,ci,candidates);
 for(const entry of candidateEntries(candidates[0].bytes)){const target=path.resolve(entry.name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,entry.bytes);}
 await writeJson('consumed-candidate.json',{candidateSha256:candidate.sha256,ciRun:ci.id,ciAttempt:ci.attempt,archive:path.resolve(candidates[0].file)});
 await verifyConsumedCandidate('consumed-candidate.json');
}else if(command==='select'){
  const req=request(),dir=arg||'.';
  const selection=selectEvidenceRuns(req,{ci:(await json(path.join(dir,'ci.json'))).workflow_runs,chrome:(await json(path.join(dir,'chrome.json'))).workflow_runs,compat:(await json(path.join(dir,'compat.json'))).workflow_runs});
  await writeJson(path.join(dir,'selection.json'),{request:req,selection});
  for(const [name,run] of Object.entries(selection)){output(name+'_run',run.id);output(name+'_attempt',run.attempt);}console.log(selection);
}else if(command==='verify'){
  const dir=arg||'.',{request:req,selection}=await json(path.join(dir,'selection.json'));assert.deepEqual(req,request(),'Release selection context changed');
  const candidates=await candidatesAt(dir);
  const chrome=await json(path.join(dir,'chrome','chrome.json'));
  const compat=await Promise.all(SUPPORTED_HOSTS.map(version=>json(path.join(dir,'compat',version,'compat.json'))));
  const evidence=validateReleaseEvidence(req,selection,{candidates,chrome,compat});
  await mkdir('verified',{recursive:true});const filename=path.join('verified',evidence.filename);await writeFile(filename,candidates[0].bytes);
  await writeFile('verified/SHA256SUMS.txt',evidence.sha256+'  '+evidence.filename+String.fromCharCode(10));await writeJson('verified/release-evidence.json',evidence);output('filename',filename);console.log(evidence);
}else throw Error('Usage: release-preflight.mjs candidate <file.tgz> <matrix> | select-ci <runs-dir> | consume <candidates-dir> | chrome | select <runs-dir> | verify <evidence-dir>');
