// Explicit, hash-pinned offline host fixture. Reject archive links and special files.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,lstat,realpath,readdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {digest} from './release-evidence.mjs';
import {validateFixtureRun,validateHostManifest} from './host-compat-policy.mjs';
import {spawnSync} from 'node:child_process';
export const FIXTURE_LIMITS=Object.freeze({memberBytes:256*1024*1024,archiveBytes:512*1024*1024,totalBytes:1024*1024*1024,members:200000});
export function addFixtureBudget(state,size=0){
 assert.ok(Number.isSafeInteger(size)&&size>=0&&size<=FIXTURE_LIMITS.memberBytes,'Host fixture member too large');
 const next={members:state.members+1,tarBytes:state.tarBytes+512+Math.ceil(size/512)*512};
 assert.ok(next.members<=FIXTURE_LIMITS.members,'Too many host fixture members');
 assert.ok(next.tarBytes+10240<=FIXTURE_LIMITS.totalBytes,'Host fixture total budget exceeded');return next;
}
// Resolve every dereferenced file/directory inside this exact fixture root.
// Return a finite materialization list, rejecting external stores, cycles and devices.
export async function fixtureTree(root){
 const base=await realpath(root),entries=[];let budget={members:0,tarBytes:0};
 const inside=target=>{const relative=path.relative(base,target);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
 const visit=async(name,ancestors=new Set())=>{
  const target=await realpath(path.join(base,name));assert.ok(inside(target),'Host fixture link escapes root: '+name);
  const stat=await lstat(target);assert.ok(stat.isFile()||stat.isDirectory(),'Host fixture special file forbidden: '+name);
  budget=addFixtureBudget(budget,stat.isDirectory()?0:stat.size);
  if(stat.isDirectory()){
   assert.ok(!ancestors.has(target),'Host fixture link cycle: '+name);entries.push({name,directory:true});
   const next=new Set(ancestors);next.add(target);for(const child of (await readdir(target)).sort())await visit(path.join(name,child),next);
  }else{assert.ok(stat.size<=FIXTURE_LIMITS.memberBytes,'Host fixture member too large');entries.push({name,target,directory:false});}
 };
 await visit('node_modules');
 for(const name of ['package-lock.json']){try{await lstat(path.join(base,name));}catch(e){if(e.code==='ENOENT')continue;throw e;}await visit(name);}
 return entries;
}
export function fixtureEntries(archive,expectedHash){
  assert.match(expectedHash??'',/^[a-f0-9]{64}$/,'Host fixture SHA-256 required');assert.equal(digest(archive),expectedHash,'Host fixture hash mismatch');
  assert.ok(archive.length<=FIXTURE_LIMITS.archiveBytes,'Host fixture archive too large');
  const tar=gunzipSync(archive,{maxOutputLength:FIXTURE_LIMITS.totalBytes});const entries=[],names=new Set();
  for(let offset=0;offset+512<=tar.length;){
    const h=tar.subarray(offset,offset+512);if(h.every(b=>b===0))break;
    const str=(a,b)=>h.subarray(a,b).toString('utf8').split(String.fromCharCode(0))[0];
    const name=((str(345,500)?str(345,500)+'/':'')+str(0,100)).replace(/[/]$/,'');
    assert.ok(name&&!name.includes(String.fromCharCode(92))&&!name.includes(':')&&!name.startsWith('/')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'),'Unsafe host fixture path');
    assert.ok(!names.has(name),'Duplicate host fixture member');names.add(name);
    const type=str(156,157);assert.ok(['','0','5'].includes(type),'Host fixture must contain only regular files and directories');
    const raw=str(124,136).trim();assert.match(raw,/^[0-7]+$/,'Invalid fixture member size');const size=parseInt(raw,8);
    assert.ok(size<=FIXTURE_LIMITS.memberBytes&&offset+512+size<=tar.length,'Invalid fixture member bounds');assert.ok(type!=='5'||size===0,'Directory data forbidden');
    entries.push({name,directory:type==='5',bytes:tar.subarray(offset+512,offset+512+size)});offset+=512+Math.ceil(size/512)*512;
  }
  assert.ok(entries.length&&entries.length<=FIXTURE_LIMITS.members,'Invalid fixture member count');return entries;
}
export async function extractHostFixture(archive,expectedHash,destination){
  const entries=fixtureEntries(archive,expectedHash);const root=path.resolve(destination);
  try{await lstat(root);throw Error('Host fixture destination must not exist');}catch(e){if(e.code!=='ENOENT')throw e;}
  await mkdir(root,{recursive:true});
  for(const entry of entries){const target=path.join(root,...entry.name.split('/'));await mkdir(entry.directory?target:path.dirname(target),{recursive:true});if(!entry.directory)await writeFile(target,entry.bytes,{flag:'wx'});}
  return root;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv[2]==='pack'){
    const [root,version,output]=process.argv.slice(3);assert.ok(root&&version&&output,'Usage: release-host-fixture.mjs pack <host-root-containing-node_modules> <exact-version> <new-output-directory>');
    const tree=await fixtureTree(root);
    validateHostManifest(JSON.parse(await readFile(path.join(root,'node_modules','@deepseek-ai','dsh','package.json'),'utf8')),version);
    const destination=path.resolve(output);try{await lstat(destination);throw Error('Output directory must not exist');}catch(e){if(e.code!=='ENOENT')throw e;}await mkdir(destination,{recursive:true});
    const file=path.join(destination,'host.tar.gz'),stage=await mkdtemp(path.join(tmpdir(),'dsh-host-pack-'));
    try{
     for(const entry of tree){const target=path.join(stage,entry.name);if(entry.directory)await mkdir(target,{recursive:true});else{assert.equal(await realpath(path.join(root,entry.name)),entry.target,'Fixture changed while packing');assert.ok((await lstat(entry.target)).isFile(),'Fixture target changed');await mkdir(path.dirname(target),{recursive:true});await writeFile(target,await readFile(entry.target),{flag:'wx'});}}
     const members=['node_modules',...(tree.some(e=>e.name==='package-lock.json')?['package-lock.json']:[])];
     const result=spawnSync('tar',['--format=ustar','-czf',file,'-C',stage,...members],{stdio:'inherit',shell:false});if(result.error)throw result.error;assert.equal(result.status,0,'Host fixture packing failed');
    }finally{await rm(stage,{recursive:true,force:true});}
    const bytes=await readFile(file),hash=digest(bytes);fixtureEntries(bytes,hash);await writeFile(path.join(destination,'SHA256SUMS.txt'),hash+'  host.tar.gz'+String.fromCharCode(10));console.log(JSON.stringify({hostVersion:version,sha256:hash,tools:{node:process.version}},null,2));process.exit(0);
  }
  if(process.argv[2]==='validate-run'){console.log(validateFixtureRun(JSON.parse(await readFile(process.argv[3],'utf8')),process.env.GITHUB_REPOSITORY,process.env.FIXTURE_DEFAULT_BRANCH));process.exit(0);}
  const [archive,hash,destination]=process.argv.slice(2);assert.ok(archive&&hash&&destination,'Usage: release-host-fixture.mjs <fixture.tar.gz> <sha256> <new-directory>');
  console.log(await extractHostFixture(await readFile(archive),hash,destination));
}
