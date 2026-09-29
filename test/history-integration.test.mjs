import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHandler,apply,RPC_CHANNEL} from '../index.mjs';
test('real references RPC supplies pinned A B targets across branch movement',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vcs-refs-rpc-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const git=args=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git(['init','-b','main']);git(['config','user.name','Refs']);git(['config','user.email','refs@example.invalid']);git(['config','core.autocrlf','false']);
 const ids=[];for(const text of ['before','after']){await fs.writeFile(path.join(root,'file.txt'),text);git(['add','.']);git(['commit','--no-gpg-sign','-m',text]);ids.push(git(['rev-parse','HEAD']));}
 git(['branch','topic',ids[0]]);git(['-c','tag.gpgSign=false','tag','-a','baseline','-m','tag',ids[0]]);await fs.writeFile(path.join(root,'file.txt'),'working');
 let handler;const routes=[];
 const ctx={sessions:{get:()=>({header:{cwd:root}})},sessionPersistence:{stat:async()=>null},effect:fn=>fn(),webServer:{register:route=>{routes.push(route.path);return()=>{};}},connection:{register:(owner,channel,callback)=>{assert.equal(owner,ctx);assert.equal(channel,RPC_CHANNEL);handler=callback;},fetch:{register:()=>{}}}};
 apply(ctx);assert.equal(typeof handler,'function');assert.equal(routes.length,3);
 const scan=await handler('vcs/repositories',{sessionId:'s'});assert.equal(scan.ok,true);
 const p={sessionId:'s',repositoryId:scan.value.repositories.find(r=>r.type==='git').id};const read=async(endpoint,extra={})=>{const result=await handler(endpoint,{...p,...extra});assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
 const refs=(await read('vcs/references')).references;const base=refs.find(r=>r.name==='refs/heads/topic').commit,target=refs.find(r=>r.name==='refs/heads/main').commit;assert.equal(refs.find(r=>r.name==='refs/tags/baseline').commit,base);
 git(['update-ref','refs/heads/topic',target]);const before=git(['status','--porcelain']),index=git(['ls-files','--stage']);
 assert.equal((await read('vcs/references')).references.find(r=>r.name==='refs/heads/topic').commit,target);
 const changes=await read('vcs/revision-changes',{base,target}),diff=await read('vcs/revision-compare',{base,target,id:changes.changes[0].id});assert.equal(diff.left.text,'before');assert.equal(diff.right.text,'after');
 assert.equal((await handler('vcs/references',{...p,sessionId:'foreign'})).error.code,'vcs/rediscover-required');assert.equal((await handler('vcs/references',{...p,prefix:'refs/remotes/'})).error.code,'vcs/invalid-request');
 assert.equal(git(['status','--porcelain']),before);assert.equal(git(['ls-files','--stage']),index);assert.equal(git(['rev-parse','HEAD']),target);assert.equal(await fs.readFile(path.join(root,'file.txt'),'utf8'),'working');
});
test('real authorized RPC traverses history details and committed diff',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vcs-history-rpc-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const git=args=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(r.status,0,r.stderr);return r.stdout;};
 git(['init','-b','main']);git(['config','user.name','History']);git(['config','user.email','history@example.invalid']);git(['config','core.autocrlf','false']);
 for(const text of ['before','after']){await fs.writeFile(path.join(root,'file.txt'),text);git(['add','file.txt']);git(['commit','--no-gpg-sign','-m',text+'\n\n中文正文\n<em>literal</em>']);}
 await fs.writeFile(path.join(root,'file.txt'),'uncommitted');
 const before=git(['status','--porcelain']),head=git(['rev-parse','HEAD']);
 const handler=createHandler({sessions:{get:()=>({header:{cwd:root}})},sessionPersistence:{stat:async()=>null}});
 const scan=await handler('vcs/repositories',{sessionId:'s'});assert.equal(scan.ok,true,JSON.stringify(scan));
 const repo=scan.value.repositories.find(r=>r.type==='git');assert.ok(repo);
 const p={sessionId:'s',repositoryId:repo.id};
 const read=async(endpoint,extra={})=>{const r=await handler(endpoint,{...p,...extra});assert.equal(r.ok,true,JSON.stringify(r));return r.value;};
 const history=await read('vcs/history',{limit:1});assert.equal(history.commits.length,1);assert.equal(history.nextOffset,1);
 const detail=await read('vcs/commit',{commit:history.commits[0].id});assert.equal(detail.changes.length,1);
 assert.equal(detail.message.trimEnd(),'after\n\n中文正文\n<em>literal</em>');assert.equal(detail.messageTruncated,false);assert.equal(Object.hasOwn(history.commits[0],'message'),false);
 assert.equal((await handler('vcs/commit',{...p,commit:detail.id,includeMessage:false})).error.code,'vcs/invalid-request');
 const result=await read('vcs/commit-compare',{commit:detail.id,id:detail.changes[0].id});assert.equal(result.left.text,'before');assert.equal(result.right.text,'after');
 const next=await read('vcs/history',{snapshot:history.snapshot,offset:1,limit:1});assert.equal(next.commits.length,1);assert.equal(next.nextOffset,null);
 const tree=await read('vcs/tree',{commit:detail.id});assert.equal(tree.commit,detail.id);
 assert.deepEqual(tree.entries,[{path:'file.txt',mode:'100644',type:'blob',oid:git(['rev-parse',detail.id+':file.txt']).trim()}]);
 assert.equal((await handler('vcs/tree',{...p,commit:detail.id,sessionId:'foreign'})).error.code,'vcs/rediscover-required');
 assert.equal((await handler('vcs/tree',{...p,commit:detail.id,path:'file.txt'})).error.code,'vcs/invalid-request');
 assert.equal((await handler('vcs/tree',{...p,commit:tree.entries[0].oid})).ok,false);
 const blameArgs={commit:detail.id,id:detail.changes[0].id};
 const blame=await read('vcs/blame',blameArgs);
 assert.equal(blame.path,'file.txt');assert.equal(blame.commit,detail.id);assert.equal(blame.truncated,false);
 assert.deepEqual(blame.lines.map(row=>[row.line,row.commit,row.text]),[[1,detail.id,'after']]);
 assert.equal(blame.lines[0].author,'History');
 assert.equal((await handler('vcs/blame',{...p,...blameArgs,sessionId:'foreign'})).error.code,'vcs/rediscover-required');
 assert.equal((await handler('vcs/blame',{...p,...blameArgs,path:'file.txt'})).error.code,'vcs/invalid-request');
 assert.equal((await handler('vcs/blame',{...p,...blameArgs,id:'f'.repeat(64)})).ok,false);
 const fileArgs={commit:detail.id,id:detail.changes[0].id,limit:1};
 const filePage=await read('vcs/file-history',fileArgs);
 assert.equal(filePage.path,'file.txt');assert.equal(filePage.followsRenames,false);assert.equal(filePage.snapshot,detail.id);
 assert.deepEqual(filePage.commits.map(c=>c.id),[detail.id]);assert.equal(filePage.nextOffset,1);
 const fileNext=await read('vcs/file-history',{...fileArgs,offset:filePage.nextOffset});
 assert.deepEqual(fileNext.commits.map(c=>c.id),[next.commits[0].id]);assert.equal(fileNext.nextOffset,null);
 assert.equal((await handler('vcs/file-history',{...p,...fileArgs,sessionId:'foreign'})).error.code,'vcs/rediscover-required');
 assert.equal((await handler('vcs/file-history',{...p,...fileArgs,path:'other.txt'})).error.code,'vcs/invalid-request');
 assert.equal((await handler('vcs/file-history',{...p,...fileArgs,id:'f'.repeat(64)})).ok,false);
 const pair={base:next.commits[0].id,target:detail.id};
 const revisions=await read('vcs/revision-changes',pair);assert.equal(revisions.changes.length,1);
 const selected={...pair,id:revisions.changes[0].id};
 const revisionDiff=await read('vcs/revision-compare',selected);
 assert.equal(revisionDiff.left.text,'before');assert.equal(revisionDiff.right.text,'after');
 const reversed=await handler('vcs/revision-compare',{...p,...selected,base:pair.target,target:pair.base});assert.equal(reversed.ok,false);
 const reverseList=await read('vcs/revision-changes',{base:pair.target,target:pair.base});
 const reverseDiff=await read('vcs/revision-compare',{base:pair.target,target:pair.base,id:reverseList.changes[0].id});
 assert.equal(reverseDiff.left.text,'after');assert.equal(reverseDiff.right.text,'before');
 assert.deepEqual((await read('vcs/revision-changes',{base:pair.base,target:pair.base})).changes,[]);
 for(const endpoint of ['vcs/revision-changes','vcs/revision-compare']){
  const args=endpoint.endsWith('compare')?selected:pair;
  assert.equal((await handler(endpoint,{...p,...args,sessionId:'foreign'})).error.code,'vcs/rediscover-required');
  assert.equal((await handler(endpoint,{...p,...args,path:'file.txt'})).error.code,'vcs/invalid-request');
 }
 const messagePath=path.join(os.tmpdir(),'vcs-message-'+path.basename(root));t.after(()=>fs.rm(messagePath,{force:true}));await fs.writeFile(messagePath,'Large\n\n'+'x'.repeat(2*1024*1024));
 const huge=git(['commit-tree',git(['rev-parse','HEAD^{tree}']).trim(),'-F',messagePath]).trim();const omitted=await read('vcs/commit',{commit:huge});assert.equal(omitted.message,'');assert.equal(omitted.messageTruncated,true);assert.equal(omitted.changes.length,1);
 const foreign=await handler('vcs/commit-compare',{...p,sessionId:'foreign',commit:detail.id,id:detail.changes[0].id});assert.equal(foreign.error.code,'vcs/rediscover-required');
 assert.equal(git(['status','--porcelain']),before);assert.equal(git(['rev-parse','HEAD']),head);assert.equal(await fs.readFile(path.join(root,'file.txt'),'utf8'),'uncommitted');
});

test('real authorized image RPC reads both renamed PNG sides without working tree fallback',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'vcs-image-rpc-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const git=args=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 git(['init','-b','main']);git(['config','user.name','Image']);git(['config','user.email','image@example.invalid']);git(['config','core.autocrlf','false']);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
 await fs.writeFile(path.join(root,'old.png'),png);git(['add','.']);git(['commit','--no-gpg-sign','-m','image']);const parent=git(['rev-parse','HEAD']);
 await fs.rename(path.join(root,'old.png'),path.join(root,'new.png'));git(['add','.']);git(['commit','--no-gpg-sign','-m','rename']);const commit=git(['rev-parse','HEAD']);
 await fs.writeFile(path.join(root,'new.png'),'uncommitted');const before=git(['status','--porcelain']),index=git(['ls-files','--stage']);
 const handler=createHandler({sessions:{get:()=>({header:{cwd:root}})},sessionPersistence:{stat:async()=>null}});
 const scan=await handler('vcs/repositories',{sessionId:'s'});assert.equal(scan.ok,true);const repo=scan.value.repositories.find(r=>r.type==='git');
 const p={sessionId:'s',repositoryId:repo.id,commit};const details=await handler('vcs/commit',p);assert.equal(details.ok,true);const args={...p,id:details.value.changes[0].id};
 for(const side of ['left','right']){
  const response=await handler('vcs/commit-image',{...args,side});assert.equal(response.ok,true,JSON.stringify(response));const value=response.value;
  assert.equal(value.commit,side==='left'?parent:commit);assert.equal(value.path,side==='left'?'old.png':'new.png');assert.equal(value.mime,'image/png');assert.equal(value.width,1);assert.equal(value.height,1);assert.deepEqual(Buffer.from(value.base64,'base64'),png);assert.equal(value.bytes,png.length);
 }
 assert.equal((await handler('vcs/commit-image',{...args,sessionId:'foreign'})).error.code,'vcs/rediscover-required');
 assert.equal((await handler('vcs/commit-image',{...args,path:'old.png'})).error.code,'vcs/invalid-request');
 assert.equal((await handler('vcs/commit-image',{...args,id:'f'.repeat(64)})).ok,false);
 assert.equal(git(['status','--porcelain']),before);assert.equal(git(['ls-files','--stage']),index);assert.equal(git(['rev-parse','HEAD']),commit);assert.equal(await fs.readFile(path.join(root,'new.png'),'utf8'),'uncommitted');
});
