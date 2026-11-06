import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import syncfs from 'node:fs';
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {deflateSync} from 'node:zlib';
import {git} from '../local-command.mjs';
import {prepareTagCreate,applyTagCreate} from '../tag-create-preview.mjs';
import {encodeGitTag} from '../src/git-tag-object.mjs';
import {withOperationBudget} from '../src/operation-budget.mjs';
const tagger={name:'发布者 é',email:'tag@invalid',timestamp:1700000000,timezone:'+0800'};
const spawn=cp.spawn;let commandHook;
cp.spawn=(command,args,options)=>{const child=spawn(command,args,{...options,env:{...options?.env,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(os.tmpdir(),'dsh-tag-confirm-no-global')}});if(command==='git')commandHook?.(args,child);return child;};syncBuiltinESMExports();
test.after(()=>{cp.spawn=spawn;syncBuiltinESMExports();});test.afterEach(()=>{commandHook=undefined;});
async function fixture(t,format='sha1'){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'dsh-tag-confirm-')));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const file=(...p)=>path.join(root,...p),run=(...a)=>git(root,a),repo={type:'git',root};
 await run('init','--object-format='+format);await run('config','core.autocrlf','false');
 const tree=(await run('mktree')).toString().trim(),ref=(await fs.readFile(file('.git','HEAD'),'utf8')).trim().slice(5);
 await fs.writeFile(file('body'),'tree '+tree+'\nauthor A <a@invalid> 1700000000 +0000\ncommitter C <c@invalid> 1700000000 +0000\n\nconfirm\n');
 const head=(await run('hash-object','-t','commit','-w','--',file('body'))).toString().trim();await fs.writeFile(file('.git',...ref.split('/')),head+'\n');await fs.rm(file('body'));
 return {repo,root,file,run,ref,head,format,preview:(name='new')=>prepareTagCreate(repo,{name,tagger,message:'release'})};
}
const opts=snapshot=>({snapshot,assertAuthorized(){},onStart(){}});
const unknown=e=>e.code==='vcs/tag-create-outcome-unknown'&&e.appendOnly===true&&e.outcomeUnknown===true;
async function state(root){const rows=[];async function walk(p,rel=''){for(const n of (await fs.readdir(p)).sort()){const f=path.join(p,n),r=rel?rel+'/'+n:n,s=await fs.lstat(f,{bigint:true});rows.push([r,[s.ino,s.birthtimeNs,s.mode,s.size,s.mtimeNs,s.ctimeNs].map(String),s.isFile()?(await fs.readFile(f)).toString('hex'):null]);if(s.isDirectory())await walk(f,r);}}await walk(root);return rows;}
for(const format of ['sha1','sha256'])for(const name of ['release','系列/安全-é'])test(format+' exact readonly prepare + create '+name,async t=>{
 const f=await fixture(t,format);await fs.writeFile(f.file('.git','index'),'opaque index');await fs.writeFile(f.file('work'),'unchanged');await f.run('config','core.logAllRefUpdates','always');
 const before=await state(f.root),snapshot=await f.preview(name);assert.deepEqual(await state(f.root),before);let starts=0;
 const result=await applyTagCreate(f.repo,{...opts(snapshot),onStart(){starts++;}});assert.equal(starts,1);
 assert.deepEqual(result,{name,ref:'refs/tags/'+name,tagOid:snapshot.object.oid,commit:f.head,currentRef:f.ref});
 assert.equal((await f.run('rev-parse','refs/tags/'+name)).toString().trim(),result.tagOid);
 const allowed=['.git/objects/'+result.tagOid.slice(0,2)+'/'+result.tagOid.slice(2),'.git/refs/tags/'+name,'.git/logs/refs/tags/'+name];
 const ancestors=new Set(allowed.flatMap(p=>p.split('/').map((_,i,a)=>a.slice(0,i).join('/'))));const old=new Map(before.map(r=>[r[0],r]));
 for(const row of await state(f.root)){if(old.has(row[0])){if(ancestors.has(row[0]))assert.deepEqual(row[1].slice(0,3),old.get(row[0])[1].slice(0,3));else assert.deepEqual(row,old.get(row[0]));old.delete(row[0]);}else assert.ok(allowed.includes(row[0])||ancestors.has(row[0]),row[0]);}assert.equal(old.size,0);
 await assert.rejects(applyTagCreate(f.repo,opts(snapshot)),/consumed/);
});
test('clone refused, exact snapshot synchronously burned on wrong repo and callbacks/options',async t=>{
 const f=await fixture(t),s=await f.preview();await assert.rejects(applyTagCreate(f.repo,opts({...s})),/snapshot/);
 for(const invalid of [o=>({...o,onStart:null}),o=>({...o,ref:'refs/tags/override'}),o=>({...o,signal:{}})]){const snapshot=await f.preview();await assert.rejects(applyTagCreate(f.repo,invalid(opts(snapshot))));await assert.rejects(applyTagCreate(f.repo,opts(snapshot)),/consumed/);}
 const p=applyTagCreate({...f.repo,root:f.root+'bad'},opts(s));const replay=applyTagCreate(f.repo,opts(s));await assert.rejects(p,/repository/);await assert.rejects(replay,/consumed/);
});
for(const kind of ['HEAD','config','index','namespace'])test('prestart original '+kind+' change burns without start',async t=>{
 const f=await fixture(t),snapshot=await f.preview();let starts=0;
 if(kind==='namespace')await fs.writeFile(f.file('.git','refs','tags','foreign'),f.head+'\n');else await fs.appendFile(f.file('.git',kind),'changed');
 const before=await state(f.root);await assert.rejects(applyTagCreate(f.repo,{...opts(snapshot),onStart(){starts++;}}),e=>!e.outcomeUnknown);assert.equal(starts,0);assert.deepEqual(await state(f.root),before);await assert.rejects(applyTagCreate(f.repo,opts(snapshot)),/consumed/);
});
test('preauthorization mutation is detected before start',async t=>{const f=await fixture(t),snapshot=await f.preview();let starts=0;await assert.rejects(applyTagCreate(f.repo,{snapshot,onStart(){starts++;},assertAuthorized:async()=>fs.appendFile(f.file('.git','config'),'\n')}));assert.equal(starts,0);});
for(const kind of ['foreign','trailing'])test('postappend '+kind+' rejected before CAS, object retained',async t=>{
 const f=await fixture(t),snapshot=await f.preview(),obj=f.file('.git','objects',snapshot.object.oid.slice(0,2),snapshot.object.oid.slice(2));let started=false,tampered=false,updates=0;
 commandHook=args=>{if(args.includes('update-ref'))updates++;};
 await assert.rejects(applyTagCreate(f.repo,{snapshot,onStart(){started=true;},assertAuthorized:async()=>{if(started&&!tampered&&syncfs.existsSync(obj)){tampered=true;if(kind==='trailing')await fs.appendFile(obj,'trailing');else await fs.writeFile(f.file('.git','foreign'),'foreign');}}}),unknown);
 assert.equal(updates,0);assert.ok(tampered);assert.ok(syncfs.existsSync(obj));assert.ok(!syncfs.existsSync(f.file('.git','refs','tags','new')));
});
for(const kind of ['ref','recreate','HEAD','headlog','config','taglog'])test('post-CAS authorization '+kind+' tampering retained unknown',async t=>{
 const f=await fixture(t);await f.run('config','core.logAllRefUpdates','always');const snapshot=await f.preview(),ref=f.file('.git','refs','tags','new');let done=false;
 await assert.rejects(applyTagCreate(f.repo,{snapshot,onStart(){},assertAuthorized:async()=>{if(!done&&syncfs.existsSync(ref)){done=true;if(kind==='recreate'){const body=await fs.readFile(ref);await fs.unlink(ref);await fs.writeFile(ref,body);}else if(kind==='ref')await fs.writeFile(ref,f.head+'\n');else await fs.appendFile(f.file('.git',...({HEAD:'HEAD',headlog:'logs/HEAD',config:'config',taglog:'logs/refs/tags/new'}[kind]).split('/')),'changed');}}}),unknown);
 assert.ok(done);assert.ok(syncfs.existsSync(ref));assert.ok(syncfs.existsSync(f.file('.git','objects',snapshot.object.oid.slice(0,2),snapshot.object.oid.slice(2))));
});
test('preexisting exact object delays single start until ref write',async t=>{
 const f=await fixture(t),encoded=encodeGitTag({object:f.head,tag:'new',tagger,message:'release'}),obj=f.file('.git','objects',encoded.oid.slice(0,2),encoded.oid.slice(2));await fs.mkdir(path.dirname(obj),{recursive:true});await fs.writeFile(obj,deflateSync(Buffer.concat([Buffer.from('tag '+encoded.body.length+'\0'),encoded.body])));
 const before=await fs.stat(obj,{bigint:true}),snapshot=await f.preview();let starts=0;
 await applyTagCreate(f.repo,{...opts(snapshot),onStart(){starts++;assert.ok(!syncfs.existsSync(f.file('.git','refs','tags','new')));}});assert.equal(starts,1);assert.equal((await fs.stat(obj,{bigint:true})).mtimeNs,before.mtimeNs);
});
test('competitor inserted at CAS is never overwritten or rolled back',async t=>{const f=await fixture(t),snapshot=await f.preview(),p=f.file('.git','refs','tags','new');commandHook=args=>{if(args.includes('update-ref'))syncfs.writeFileSync(p,f.head+'\n');};await assert.rejects(applyTagCreate(f.repo,opts(snapshot)),unknown);assert.equal(await fs.readFile(p,'utf8'),f.head+'\n');});
test('prestart abort/auth and inherited deadline have no repository change',async t=>{const f=await fixture(t);for(const kind of ['abort','auth','deadline']){const snapshot=await f.preview(),before=await state(f.root),c=new AbortController();if(kind==='abort')c.abort();let starts=0;const work=()=>applyTagCreate(f.repo,{snapshot,signal:c.signal,onStart(){starts++;},assertAuthorized(){if(kind==='auth')throw Error('revoked');}});await assert.rejects(kind==='deadline'?withOperationBudget({timeoutMs:1},work):work());assert.equal(starts,0);assert.deepEqual(await state(f.root),before);}});
test('postappend cancellation and authorization revocation retain object and refuse ref',async t=>{for(const kind of ['abort','auth']){const f=await fixture(t),snapshot=await f.preview(),controller=new AbortController(),obj=f.file('.git','objects',snapshot.object.oid.slice(0,2),snapshot.object.oid.slice(2));let started=false;await assert.rejects(applyTagCreate(f.repo,{snapshot,signal:controller.signal,onStart(){started=true;},assertAuthorized(){if(started&&syncfs.existsSync(obj)){if(kind==='abort')controller.abort();else throw Error('revoked');}}}),unknown);assert.ok(syncfs.existsSync(obj));assert.ok(!syncfs.existsSync(f.file('.git','refs','tags','new')));}});
test('authorization awaits inherit cancellation deadline rather than hanging',async t=>{const f=await fixture(t),snapshot=await f.preview(),before=await state(f.root);let calls=0,starts=0;await assert.rejects(withOperationBudget({timeoutMs:2500},()=>applyTagCreate(f.repo,{snapshot,onStart(){starts++;},assertAuthorized(){calls++;return new Promise(()=>{});}})),e=>e.code==='TIMEOUT');assert.equal(calls,1);assert.equal(starts,0);assert.deepEqual(await state(f.root),before);});
test('preexisting object prestart abort leaves metadata unchanged',async t=>{const f=await fixture(t),encoded=encodeGitTag({object:f.head,tag:'new',tagger,message:'release'}),obj=f.file('.git','objects',encoded.oid.slice(0,2),encoded.oid.slice(2));await fs.mkdir(path.dirname(obj),{recursive:true});await fs.writeFile(obj,deflateSync(Buffer.concat([Buffer.from('tag '+encoded.body.length+'\0'),encoded.body])));const snapshot=await f.preview(),before=await state(f.root),controller=new AbortController();controller.abort();let starts=0;await assert.rejects(applyTagCreate(f.repo,{...opts(snapshot),signal:controller.signal,onStart(){starts++;}}));assert.equal(starts,0);assert.deepEqual(await state(f.root),before);});
test('thenable onStart refuses synchronously, normalized unknown with no final object/ref',async t=>{const f=await fixture(t),snapshot=await f.preview();let starts=0;await assert.rejects(applyTagCreate(f.repo,{...opts(snapshot),onStart(){starts++;return Promise.resolve();}}),unknown);assert.equal(starts,1);assert.ok(!syncfs.existsSync(f.file('.git','refs','tags','new')));assert.ok(!syncfs.existsSync(f.file('.git','objects',snapshot.object.oid.slice(0,2),snapshot.object.oid.slice(2))));});
