// Install the actual tarball outside the source checkout, without development dependencies.
import {mkdtemp,writeFile,rm,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const npm=process.env.npm_execpath;
if(!npm) throw new Error('Run via npm run test:install');
const root=process.cwd();
const temp=await mkdtemp(path.join(tmpdir(),'dsh-vcs-install-'));
function run(args,cwd){const r=spawnSync(process.execPath,[npm,...args],{cwd,encoding:'utf8',windowsHide:true});if(r.error)throw r.error;if(r.status!==0)throw new Error(r.stderr||r.stdout);return r.stdout;}
try {
 const packed=JSON.parse(run(['pack','--ignore-scripts','--json','--pack-destination',temp],root));
 const archive=path.join(temp,packed[0].filename);
 await writeFile(path.join(temp,'package.json'),JSON.stringify({private:true}));
 run(['install','--omit=dev','--no-audit','--no-fund',archive],temp);
 const installed=path.join(temp,'node_modules','@local','dsh-vcs');
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
