import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {detectRepository,listChanges,getComparison} from '../vcs.mjs';
test('local SVN comparison stops after cancellation in info BASE and both property stages',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vcs-svn-cancel-')),wc=path.join(root,'wc'),spawn=cp.spawn,run=(command,args)=>cp.execFileSync(command,args,{encoding:'utf8',windowsHide:true});
 try{run('svnadmin',['create',path.join(root,'repo')]);run('svn',['checkout',pathToFileURL(path.join(root,'repo')).href,wc]);await fs.writeFile(path.join(wc,'a.txt'),'base');run('svn',['add',path.join(wc,'a.txt')]);run('svn',['commit','-m','seed',wc]);await fs.writeFile(path.join(wc,'a.txt'),'changed');run('svn',['propset','review-prop','value',path.join(wc,'a.txt')]);const repo=await detectRepository(wc),id=(await listChanges(repo))[0].id;
 for(const stage of ['info','cat','base-props','working-props']){
 const c=new AbortController(),calls=[];let hit=false;
 cp.spawn=(command,args,options)=>{if(command==='svn'){calls.push(args);const op=args[1],selected=stage==='info'?op==='info'&&args.includes('a.txt@'):stage==='cat'?op==='cat':op==='proplist'&&(stage==='base-props'?args.includes('BASE'):!args.includes('BASE'));if(selected){hit=true;const child=spawn(command,args,options);c.abort();return child;}if(hit)assert.fail('Started command after cancelled '+stage);}return spawn(command,args,options);};syncBuiltinESMExports();
 await assert.rejects(getComparison(repo,{id,signal:c.signal}),e=>e.name==='AbortError'||e.code==='ABORT_ERR');assert.ok(hit,stage);assert.equal(calls.filter(a=>a[1]==='proplist').length,stage==='base-props'?1:stage==='working-props'?2:0);
 cp.spawn=spawn;syncBuiltinESMExports();const recovered=await getComparison(repo,{id});assert.equal(recovered.right.text,'changed');assert.equal(recovered.properties.right['review-prop'],'value');
 }
 }finally{cp.spawn=spawn;syncBuiltinESMExports();await fs.rm(root,{recursive:true,force:true,maxRetries:5});}
});
