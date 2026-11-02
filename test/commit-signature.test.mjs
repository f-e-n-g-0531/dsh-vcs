import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parseCommitSignature} from '../src/commit-signature.mjs';
import {detectRepository,getCommitDetails} from '../vcs.mjs';
const lf=String.fromCharCode(10);
const g=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
const hashCommit=(root,raw)=>execFileSync('git',['-C',root,'hash-object','-t','commit','-w','--stdin'],{input:raw,encoding:'utf8',windowsHide:true}).trim();
const signatureHeader=(field,format)=>[field+' -----BEGIN '+format+' SIGNATURE-----',' c2lnbmF0dXJl',' -----END '+format+' SIGNATURE-----'].join(lf);

test('signature classification uses real Git multiline gpgsig armor, not the hash header name',()=>{
  const none={signed:false,format:null};
  for(const raw of [undefined,'',['tree a','','gpgsig fake'].join(lf),['tree a','sshsig -----BEGIN SSH SIGNATURE-----',' xx','','msg'].join(lf)]) assert.deepEqual(parseCommitSignature(raw),none);
  for(const field of ['gpgsig','gpgsig-sha256']) for(const [armor,format] of [['PGP','OpenPGP'],['SSH','SSH']]) {
    const raw=['tree a',signatureHeader(field,armor),'','msg'].join(lf);
    assert.deepEqual(parseCommitSignature(raw),{signed:true,format});
  }
  assert.deepEqual(parseCommitSignature(['tree a','gpgsig opaque future format',' continued','','msg'].join(lf)),{signed:true,format:'Unknown'});
  // A continuation of another field is not a new signature, nor is a message body.
  assert.deepEqual(parseCommitSignature(['tree a','mergetag object a',' gpgsig -----BEGIN SSH SIGNATURE-----','','msg'].join(lf)),none);
  assert.deepEqual(parseCommitSignature(['tree a','gpgsig opaque','extra header',' -----BEGIN SSH SIGNATURE-----','','msg'].join(lf)),{signed:true,format:'Unknown'});
});

test('commit details classify raw Git signature headers and leave repository unchanged',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vcs-sig-'));
  try {
    g(root,'init','-q');g(root,'config','user.name','T');g(root,'config','user.email','t@example.test');
    await writeFile(path.join(root,'f'),'hello'+lf);g(root,'add','.');g(root,'commit','-q','-m','base');
    const tree=g(root,'rev-parse','HEAD^{tree}').trim(),parent=g(root,'rev-parse','HEAD').trim(),info='T <t@example.test> 1600000000 +0000';
    const repo=await detectRepository(root);
    assert.deepEqual((await getCommitDetails(repo,{commit:parent})).signature,{signed:false,format:null});
    for(const field of ['gpgsig','gpgsig-sha256']) for(const [armor,format] of [['PGP','OpenPGP'],['SSH','SSH']]) {
      const raw=['tree '+tree,'parent '+parent,'author '+info,'committer '+info,signatureHeader(field,armor),'','signed subject',''].join(lf);
      const commit=hashCommit(root,raw);
      assert.equal(g(root,'cat-file','commit',commit),raw);
      assert.deepEqual((await getCommitDetails(repo,{commit})).signature,{signed:true,format});
    }
    assert.equal(g(root,'status','--porcelain'),'');
    assert.equal(g(root,'rev-parse','HEAD').trim(),parent);
  } finally {await rm(root,{recursive:true,force:true});}
});
