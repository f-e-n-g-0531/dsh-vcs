import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {XMLParser} from 'fast-xml-parser';
import {parseSvnLogPage} from '../src/svn-log.mjs';
import {svnPathInScope,relativeSvnPath} from '../src/svn-path.mjs';
test('local SVN path history skips unrelated revisions and pins numeric snapshot',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'dsh-svn-history-'));t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:5}));
 const run=(name,args,cwd=root)=>{const r=spawnSync(name,args,{cwd,encoding:'utf8',windowsHide:true,timeout:20000,env:{...process.env,LC_ALL:process.platform==='linux'?'C.UTF-8':'en_US.UTF-8'}});assert.equal(r.status,0,r.stderr);return r.stdout;};
 const repository=path.join(root,'repo'),wc=path.join(root,'wc');run('svnadmin',['create',repository]);run('svn',['checkout','--non-interactive',pathToFileURL(repository).href,wc]);
 const emptyXml=run('svn',['log','--non-interactive','--no-auth-cache','--xml','-r','0:0','--',pathToFileURL(repository).href+'@0']);
 const emptyPage=parseSvnLogPage(emptyXml,{snapshot:'0'});assert.equal(emptyPage.nextRevision,null);assert.ok(emptyPage.entries.every(e=>e.revision==='0'));
 const name='中文 @ percent%.txt',file=path.join(wc,name);
 const svn=args=>run('svn',['--non-interactive','--no-auth-cache',...args],wc);
 await fs.writeFile(file,'r1');await fs.writeFile(path.join(wc,'other'),'r1');svn(['add','--',name+'@','other']);svn(['commit','-m','r1']);
 await fs.writeFile(path.join(wc,'other'),'r2');svn(['commit','-m','r2']);
 await fs.writeFile(file,'r3');svn(['commit','-m','r3']);
 await fs.writeFile(file,'r4');svn(['commit','-m','r4']);
 const parser=new XMLParser({ignoreAttributes:false,parseAttributeValue:false,isArray:name=>name==='logentry'});
 const pageAt=cursor=>parseSvnLogPage(svn(['log','--xml','--stop-on-copy','--limit','2','-r',cursor+':0','--',name+'@3']),{snapshot:'3',cursor,limit:1});
 const status=svn(['status','--xml']),info=svn(['info','--xml','--',name+'@']);
 const page=pageAt('3');assert.equal(page.snapshot,'3');assert.equal(page.nextRevision,'2');assert.deepEqual(page.entries.map(e=>[e.revision,e.message]),[['3','r3']]);
 const next=pageAt(page.nextRevision);assert.equal(next.snapshot,'3');assert.equal(next.nextRevision,null);assert.deepEqual(next.entries.map(e=>[e.revision,e.message]),[['1','r1']]);
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
 await fs.writeFile(path.join(wc,'copy.txt'),'new identity r8');svn(['add','--','copy.txt']);svn(['commit','-m','r8 recreate']);
 const recreatedStatus=parser.parse(svn(['status','--xml']));
 const newHistory=parser.parse(svn(['log','--xml','--verbose','--stop-on-copy','-r','8:0','--',copyUrl+'@8'])).log.logentry;
 assert.deepEqual(newHistory.map(e=>e['@_revision']),['8']);assert.equal(newHistory[0].paths.path['@_action'],'A');assert.equal(newHistory[0].paths.path['@_copyfrom-rev'],undefined);
 const oldHistory=parser.parse(svn(['log','--xml','--stop-on-copy','-r','6:0','--',copyUrl+'@6'])).log.logentry;assert.deepEqual(oldHistory.map(e=>e['@_revision']),['6','5']);
 assert.equal(svn(['cat','-r','6','--',copyUrl+'@6']),'r6');assert.equal(svn(['cat','-r','8','--',copyUrl+'@8']),'new identity r8');
 assert.deepEqual(parser.parse(svn(['status','--xml'])),recreatedStatus);assert.equal(await fs.readFile(path.join(wc,'copy.txt'),'utf8'),'new identity r8');
 // A path-scoped verbose log still describes the entire shared revision.
 for(const directory of ['scope','scope-other']){await fs.mkdir(path.join(wc,directory));await fs.writeFile(path.join(wc,directory,'file'),'r9');}
 svn(['add','--','scope','scope-other']);svn(['commit','-m','r9 shared scope']);
 const scopedStatus=parser.parse(svn(['status','--xml']));
 const scoped=parser.parse(svn(['log','--xml','--verbose','-r','9:9','--',rootUrl+'/scope@9'])).log.logentry[0];
 const paths=scoped.paths.path.map(p=>p['#text']);
 assert.ok(paths.includes('/scope-other/file'),'Positive control: verbose log exposes paths outside query scope');
 const allowed=paths.filter(p=>svnPathInScope(p,'/scope'));assert.deepEqual(allowed.sort(),['/scope','/scope/file']);
 assert.deepEqual(allowed.map(p=>relativeSvnPath(p,'/scope')),['','file']);
 assert.deepEqual(parser.parse(svn(['status','--xml'])),scopedStatus);
});
