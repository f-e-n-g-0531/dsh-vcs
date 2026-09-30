import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {XMLParser} from 'fast-xml-parser';
import {svnRevisionPage} from '../src/svn-revision.mjs';
test('local SVN path history skips unrelated revisions and pins numeric snapshot',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-svn-history-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const run=(name,args,cwd=root)=>{const r=spawnSync(name,args,{cwd,encoding:'utf8',windowsHide:true,timeout:20000,env:{...process.env,LC_ALL:process.platform==='linux'?'C.UTF-8':'en_US.UTF-8'}});assert.equal(r.status,0,r.stderr);return r.stdout;};
 const repository=path.join(root,'repo'),wc=path.join(root,'wc');run('svnadmin',['create',repository]);run('svn',['checkout','--non-interactive',pathToFileURL(repository).href,wc]);
 const name='中文 @ percent%.txt',file=path.join(wc,name);
 const svn=args=>run('svn',['--non-interactive','--no-auth-cache',...args],wc);
 await fs.writeFile(file,'r1');await fs.writeFile(path.join(wc,'other'),'r1');svn(['add','--',name+'@','other']);svn(['commit','-m','r1']);
 await fs.writeFile(path.join(wc,'other'),'r2');svn(['commit','-m','r2']);
 await fs.writeFile(file,'r3');svn(['commit','-m','r3']);
 await fs.writeFile(file,'r4');svn(['commit','-m','r4']);
 const parser=new XMLParser({ignoreAttributes:false,parseAttributeValue:false,isArray:name=>name==='logentry'});
 const revisions=(upper,limit)=>{const xml=svn(['log','--xml','--stop-on-copy','--limit',String(limit),'-r',upper+':0','--',name+'@3']);return (parser.parse(xml).log.logentry||[]).map(e=>e['@_revision']);};
 const status=svn(['status','--xml']),info=svn(['info','--xml','--',name+'@']);
 const page=svnRevisionPage(revisions('3',2),{snapshot:'3',limit:1});assert.deepEqual(page,{snapshot:'3',revisions:['3'],nextRevision:'2'});
 assert.deepEqual(svnRevisionPage(revisions(page.nextRevision,2),{snapshot:'3',cursor:page.nextRevision,limit:1}),{snapshot:'3',revisions:['1'],nextRevision:null});
 assert.equal(svn(['cat','-r','3','--',name+'@3']),'r3');assert.equal(await fs.readFile(file,'utf8'),'r4');
 assert.deepEqual(parser.parse(svn(['status','--xml'])),parser.parse(status));assert.deepEqual(parser.parse(svn(['info','--xml','--',name+'@'])),parser.parse(info));
 // Fixture writes create a copy at r5; subsequent review commands remain read-only.
 svn(['copy','--',name+'@','copy.txt']);svn(['commit','-m','r5 copy']);
 await fs.writeFile(path.join(wc,'copy.txt'),'r6');svn(['commit','-m','r6 edit']);
 const copyStatus=svn(['status','--xml']),copyInfo=svn(['info','--xml','--','copy.txt@']);
 const copyLog=stop=>parser.parse(svn(['log','--xml','--verbose',...(stop?['--stop-on-copy']:[]),'-r','6:0','--','copy.txt@6'])).log.logentry;
 const stopped=copyLog(true);assert.deepEqual(stopped.map(e=>e['@_revision']),['6','5']);
 const copy=stopped[1].paths.path;assert.equal(copy['@_action'],'A');assert.equal(copy['@_copyfrom-path'],'/'+name);assert.equal(copy['@_copyfrom-rev'],'4');
 // Positive control proves the default command would cross the copy boundary.
 assert.deepEqual(copyLog(false).map(e=>e['@_revision']),['6','5','4','3','1']);
 assert.equal(svn(['cat','-r','5','--','copy.txt@6']),'r4');
 assert.deepEqual(parser.parse(svn(['status','--xml'])),parser.parse(copyStatus));assert.deepEqual(parser.parse(svn(['info','--xml','--','copy.txt@'])),parser.parse(copyInfo));assert.equal(await fs.readFile(path.join(wc,'copy.txt'),'utf8'),'r6');
 // Delete only in the temporary fixture; use the repository URL for the old identity.
 svn(['delete','--','copy.txt']);svn(['commit','-m','r7 deletion']);
 const deletedStatus=parser.parse(svn(['status','--xml']));
 const rootUrl=pathToFileURL(repository).href,copyUrl=rootUrl+'/copy.txt';
 const deletion=parser.parse(svn(['log','--xml','--verbose','-r','7:7','--',rootUrl+'@7'])).log.logentry[0];
 assert.equal(deletion.paths.path['@_action'],'D');assert.equal(deletion.paths.path['#text'],'/copy.txt');
 assert.equal(svn(['cat','-r','6','--',copyUrl+'@6']),'r6');
 await assert.rejects(fs.stat(path.join(wc,'copy.txt')),{code:'ENOENT'});
 assert.deepEqual(parser.parse(svn(['status','--xml'])),deletedStatus);
});
