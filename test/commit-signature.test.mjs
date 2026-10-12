import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {parseCommitSignature} from '../src/commit-signature.mjs';
import {detectRepository,getCommitDetails} from '../vcs.mjs';
const g=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true});
const hashCommit=(root,raw)=>execFileSync('git',['-C',root,'hash-object','-t','commit','-w','--stdin'],{input:raw,encoding:'utf8',windowsHide:true}).trim();

test('parseCommitSignature detects signature headers in the header section only',()=>{
  assert.deepEqual(parseCommitSignature(undefined),{signed:false,format:null});
  assert.deepEqual(parseCommitSignature(''),{signed:false,format:null});
  assert.deepEqual(parseCommitSignature('tree a\n\nauthor line in body\ngpgsig fake\n'),{signed:false,format:null},'gpgsig in body is not a signature');
  assert.deepEqual(parseCommitSignature('tree a\ngpgsig -----BEGIN PGP SIGNATURE-----\n xx\n -----END PGP SIGNATURE-----\n\nmsg'),{signed:true,format:'OpenPGP'});
  assert.deepEqual(parseCommitSignature('tree a\ngpgsig-sha256 -----BEGIN SIGNATURE-----\n xx\n -----END SIGNATURE-----\n\nmsg'),{signed:true,format:'OpenPGP-SHA256'});
  assert.deepEqual(parseCommitSignature('tree a\nsshsig -----BEGIN SSH SIGNATURE-----\n xx\n -----END SSH SIGNATURE-----\n\nmsg'),{signed:true,format:'SSH'});
});

test('commit details report signature presence from the raw object and stay unsigned for normal commits',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'vcs-sig-'));
  try{
    g(root,'init','-q');g(root,'config','user.name','T');g(root,'config','user.email','t@example.test');
    await writeFile(path.join(root,'f'),'hello\n');g(root,'add','.');g(root,'commit','-q','-m','base');
    const tree=g(root,'rev-parse','HEAD^{tree}').trim(),parent=g(root,'rev-parse','HEAD').trim();
    const info='T <t@example.test> 1600000000 +0000';
    const signed=hashCommit(root,`tree ${tree}\nparent ${parent}\nauthor ${info}\ncommitter ${info}\ngpgsig -----BEGIN PGP SIGNATURE-----\n fake\n fake2\n -----END PGP SIGNATURE-----\n\nsigned subject\n`);
    const ssh=hashCommit(root,`tree ${tree}\nparent ${parent}\nauthor ${info}\ncommitter ${info}\nsshsig -----BEGIN SSH SIGNATURE-----\n fake\n -----END SSH SIGNATURE-----\n\nssh subject\n`);
    const repo=await detectRepository(root);
    assert.deepEqual((await getCommitDetails(repo,{commit:parent})).signature,{signed:false,format:null});
    assert.deepEqual((await getCommitDetails(repo,{commit:signed})).signature,{signed:true,format:'OpenPGP'});
    assert.deepEqual((await getCommitDetails(repo,{commit:ssh})).signature,{signed:true,format:'SSH'});
    assert.equal(g(root,'status','--porcelain'),'');
  }finally{await rm(root,{recursive:true,force:true});}
});