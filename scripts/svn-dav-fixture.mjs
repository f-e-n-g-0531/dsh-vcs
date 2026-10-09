import {execFileSync,spawn} from 'node:child_process';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
// CI-only Apache on loopback. No production or external SVN target.
const dir=await mkdtemp(path.join(os.tmpdir(),'vcs-apache-')),repo=path.join(dir,'repo'),config=path.join(dir,'httpd.conf');let child;try{execFileSync('svnadmin',['create',repo]);const uuid=execFileSync('svnlook',['uuid',repo],{encoding:'utf8'}).trim(),user=os.userInfo().username;await writeFile(config,`ServerRoot /etc/apache2
ServerName localhost
Listen 127.0.0.1:8877
PidFile ${dir}/pid
ErrorLog ${process.cwd()}/test-results/svn-apache.log
LoadModule mpm_event_module /usr/lib/apache2/modules/mod_mpm_event.so
LoadModule authz_core_module /usr/lib/apache2/modules/mod_authz_core.so
LoadModule dav_module /usr/lib/apache2/modules/mod_dav.so
LoadModule dav_svn_module /usr/lib/apache2/modules/mod_dav_svn.so
User ${user}
Group ${user}
<Location /repo>
 DAV svn
 SVNPath ${repo}
 Require all granted
</Location>
`);child=spawn('/usr/sbin/apache2',['-X','-f',config],{stdio:'inherit'});let ready=false;for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:8877/repo');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'isolated Apache readiness');const body='<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:S="http://subversion.tigris.org/xmlns/dav/"><D:prop><S:repository-uuid/><D:version-controlled-configuration/></D:prop></D:propfind>',response=await fetch('http://127.0.0.1:8877/repo',{method:'PROPFIND',headers:{Depth:'0','Content-Type':'text/xml'},body}),xml=await response.text();await writeFile('test-results/svn-dav-discovery-wire.xml',xml);assert.equal(response.status,207);assert.ok(xml.includes(uuid));assert.ok(xml.includes('version-controlled-configuration'));await writeFile('test-results/svn-dav-wire-report.json',JSON.stringify({pass:true,uuid,status:response.status,scope:'actual Apache mod_dav_svn loopback HTTP discovery only; not production TLS or baseline acceptance'}));}catch(error){console.error('Isolated DAV fixture failed:',error.message);process.exitCode=1;}finally{if(child){child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('close',resolve);});}await rm(dir,{recursive:true,force:true});}
