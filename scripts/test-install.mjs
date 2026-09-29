// Install the actual tarball outside the source checkout, without development dependencies.
import {mkdtemp,writeFile,rm,readFile,access,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {parsePackReport} from './pack-report.mjs';
import {pathToFileURL} from 'node:url';
const npm=process.env.npm_execpath;
if(!npm) throw new Error('Run via npm run test:install');
const root=process.cwd();
assert.ok(process.argv.length<=3,'Usage: npm run test:install -- [local-tarball.tgz]');
const supplied=process.argv[2]?path.resolve(root,process.argv[2]):null;
if(supplied){assert.ok(supplied.endsWith('.tgz'),'Expected a local .tgz');assert.ok((await stat(supplied)).isFile(),'Expected a regular file');}
const temp=await mkdtemp(path.join(tmpdir(),'dsh-vcs-install-'));
function run(args,cwd){const r=spawnSync(process.execPath,[npm,...args],{cwd,encoding:'utf8',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw new Error(r.stderr||r.stdout);return r.stdout;}
try {
 const archive=supplied||path.join(temp,parsePackReport(run(['pack','--ignore-scripts','--json','--pack-destination',temp],root))[0].filename);
 console.log('Testing tarball SHA-256:',createHash('sha256').update(await readFile(archive)).digest('hex'));
 await writeFile(path.join(temp,'package.json'),JSON.stringify({private:true}));
 run(['install','--omit=dev','--no-audit','--no-fund',archive],temp);
 const installed=path.join(temp,'node_modules','@feng0531','dsh-vcs');
 const manifest=JSON.parse(await readFile(path.join(installed,'package.json'),'utf8'));
 for(const file of ['index.mjs','vcs.mjs','dist/client.js','dist/editor.js','dist/editor.css','dist/editor.worker.js','LICENSE','dist/MONACO-LICENSE.txt','dist/MONACO-ThirdPartyNotices.txt','cordis.patch.yml'])await access(path.join(installed,file));
 const plugin=await import(pathToFileURL(path.join(installed,'index.mjs')).href);
 assert.equal(typeof plugin.apply,'function');assert.ok(plugin.inject.includes('webServer'));
 const routes=[];let handler;let owner;
 const ctx={effect:fn=>fn(),webServer:{register:r=>{routes.push(r);return()=>{};}},connection:{register:(o,c,h)=>{owner=o;assert.equal(c,'/vcs-rpc');handler=h;},fetch:{register:()=>()=>{}},admit:async()=>({ok:false,status:401})}};
 plugin.apply(ctx);assert.equal(owner,ctx);assert.equal(typeof handler,'function');assert.equal(routes.length,3);
 console.log('Production-only tarball install and host-entry registration passed:',manifest.version);
 console.log('Registration uses a stub host; this is not live DSH or browser acceptance.');
} finally {await rm(temp,{recursive:true,force:true});}
