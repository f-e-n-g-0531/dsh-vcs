// Explicit official-host preparation only; never touches an installed DSH profile.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {SUPPORTED_HOSTS} from './host-compat-policy.mjs';
export function hostPreparationManifest(version){
 assert.ok(SUPPORTED_HOSTS.includes(version),'Unsupported exact host');
 return {name:'dsh-vcs-isolated-host-fixture',version:'1.0.0',private:true,dependencies:{'@deepseek-ai/dsh':version,'@deepseek-ai/dsh-client-ui-slots':version}};
}
export function validateOfficialHostLock(lock,version){
 const manifest=hostPreparationManifest(version);
 assert.equal(lock.lockfileVersion,3,'Expected npm v3 lockfile');
 assert.deepEqual(lock.packages?.['']?.dependencies,manifest.dependencies,'Exact official roots required');
 for(const [name,row] of Object.entries(lock.packages)){
  if(!name)continue;
  assert.ok(name.startsWith('node_modules/')&&!name.split('/').includes('..'),'Unsafe lockfile package path');
  assert.ok(!row.link,'Linked dependency forbidden');
  assert.ok(typeof row.version==='string'&&row.version.length>0,'Missing resolved version');
  const url=new URL(row.resolved);
  assert.equal(url.protocol,'https:');assert.equal(url.hostname,'registry.npmjs.org');
  assert.equal(url.port,'');assert.equal(url.username,'');assert.equal(url.password,'');
  assert.match(row.integrity??'',/^sha512-[A-Za-z0-9+/]+={0,2}$/,'Registry integrity required');
 }
 for(const name of Object.keys(manifest.dependencies))assert.equal(lock.packages['node_modules/'+name]?.version,version,'Exact installed host roots required');
 return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const [action,root,version,output]=process.argv.slice(2);
 assert.ok(root&&SUPPORTED_HOSTS.includes(version),'Usage: prepare-host-fixture.mjs init|validate|attest <fixture-root> <exact-version> [existing-output-dir]');
 if(action==='init'){await mkdir(root,{recursive:false});await writeFile(path.join(root,'package.json'),JSON.stringify(hostPreparationManifest(version),null,2)+'\n',{flag:'wx'});}
 else if(action==='validate'){validateOfficialHostLock(JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8')),version);}
 else if(action==='attest'){
  assert.ok(output,'Attestation output required');
  const bytes=await readFile(path.join(root,'package-lock.json'));validateOfficialHostLock(JSON.parse(bytes),version);
  for(const name of ['dsh','dsh-client-ui-slots']){const m=JSON.parse(await readFile(path.join(root,'node_modules','@deepseek-ai',name,'package.json'),'utf8'));assert.equal(m.name,'@deepseek-ai/'+name);assert.equal(m.version,version);}
  await writeFile(path.join(output,'package-lock.json'),bytes,{flag:'wx'});
  await writeFile(path.join(output,'preparation.json'),JSON.stringify({schema:1,hostVersion:version,source:'https://registry.npmjs.org',lockSha256:createHash('sha256').update(bytes).digest('hex'),installScripts:false,node:process.version,runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT,sha:process.env.GITHUB_SHA},null,2)+'\n',{flag:'wx'});
 }else throw Error('Unknown preparation action');
}
