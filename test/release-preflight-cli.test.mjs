import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {digest,MATRIX} from '../scripts/release-evidence.mjs';
import {SUPPORTED_HOSTS} from '../scripts/host-compat-policy.mjs';
const script=fileURLToPath(new URL('../scripts/release-preflight.mjs',import.meta.url));
const json=async(file,value)=>{await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(value));};
test('offline CLI verifies four candidate archives and copies only authenticated bytes for both channels',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-release-cli-'));
 try{
  const body=Buffer.from(JSON.stringify({name:'@feng0531/dsh-vcs',version:'1.2.3'})),h=Buffer.alloc(512);h.write('package/package.json');h.write(body.length.toString(8).padStart(11,'0'),124);h.write('0',156);const bytes=gzipSync(Buffer.concat([h,body,Buffer.alloc((512-body.length%512)%512+1024)]));
  for(const channel of ['both','github-only']){
   const cwd=path.join(root,channel);await mkdir(cwd);const env={...process.env,RELEASE_TAG:'v1.2.3',RELEASE_SHA:'a'.repeat(40),RELEASE_CHANNEL:channel,GITHUB_REPOSITORY:'owner/repo',GITHUB_REF_TYPE:'tag',GITHUB_REF:'refs/tags/v1.2.3'};
   const execute=(...args)=>spawnSync(process.execPath,[script,...args],{cwd,env,encoding:'utf8',timeout:10000});
   for(const [name,id,event] of [['ci',1,'push'],['chrome',2,'workflow_dispatch'],['compat',3,'workflow_dispatch']])await json(path.join(cwd,'evidence',name+'.json'),{workflow_runs:[{id,run_attempt:1,event,head_sha:env.RELEASE_SHA,head_branch:env.RELEASE_TAG,status:'completed',conclusion:'success',head_repository:{full_name:'owner/repo'}}]});
   assert.equal(execute('select','evidence').status,0);
   const binding=id=>({schema:1,ref:'refs/tags/'+env.RELEASE_TAG,refType:'tag',tag:env.RELEASE_TAG,sha:env.RELEASE_SHA,runId:id,runAttempt:1});
   for(const matrix of MATRIX){const folder=path.join(cwd,'evidence','candidates',matrix);await json(path.join(folder,'candidate.json'),{...binding(1),matrix,version:'1.2.3',filename:'candidate.tgz',sha256:digest(bytes),size:bytes.length,tests:{tests:1,pass:1,fail:0,cancelled:0,skipped:0,todo:0},tools:{node:'22',git:'2',svn:'1',svnadmin:'1',openssl:'3'}});await writeFile(path.join(folder,'candidate.tgz'),bytes);}
   await json(path.join(cwd,'evidence/chrome/chrome.json'),{...binding(2),candidateSha256:digest(bytes),ciRun:1,ciAttempt:1,passed:true,tools:{node:'22',chrome:'Chrome 130'}});
   for(const hostVersion of SUPPORTED_HOSTS)await json(path.join(cwd,'evidence/compat',hostVersion,'compat.json'),{...binding(3),candidateSha256:digest(bytes),ciRun:1,ciAttempt:1,hostVersion,pluginVersion:'1.2.3',passed:true,tools:{node:'22',host:hostVersion},contracts:['peer-gate','registration','authentication','session','assets','rpc','lazy-client','dispose-reload']});
   const result=execute('verify','evidence');assert.equal(result.status,0,result.stderr);assert.deepEqual(await readFile(path.join(cwd,'verified/candidate.tgz')),bytes);assert.equal(JSON.parse(await readFile(path.join(cwd,'verified/release-evidence.json'),'utf8')).channel,channel);
   const checksum=await readFile(path.join(cwd,'verified/SHA256SUMS.txt'),'utf8'),[hash,filename]=checksum.trim().split(/  /);assert.equal(filename,'candidate.tgz');assert.equal(digest(await readFile(path.join(cwd,'verified',filename))),hash);
   const download=path.join(cwd,'download');await mkdir(download);await writeFile(path.join(download,filename),await readFile(path.join(cwd,'verified',filename)));await writeFile(path.join(download,'SHA256SUMS.txt'),checksum);assert.equal(digest(await readFile(path.join(download,filename))),hash);
   // select-ci/consume must accept the same four packages without Chrome/host evidence.
   assert.equal(execute('select-ci','evidence').status,0);assert.equal(execute('consume','evidence').status,0);
   env.GITHUB_RUN_ID='2';env.GITHUB_RUN_ATTEMPT='1';await json(path.join(cwd,'test-results/browser-tools.json'),{node:'22',chrome:'Chrome'});
   assert.equal(execute('chrome').status,0);assert.equal(JSON.parse(await readFile(path.join(cwd,'test-results/chrome.json'),'utf8')).candidateSha256,digest(bytes));
   await writeFile(path.join(cwd,'package.json'),'changed after consumption');assert.notEqual(execute('chrome').status,0);
   await writeFile(path.join(cwd,'evidence/candidates',MATRIX[1],'candidate.tgz'),Buffer.from('different'));assert.notEqual(execute('verify','evidence').status,0);
  }
 }finally{await rm(root,{recursive:true,force:true});}
});
