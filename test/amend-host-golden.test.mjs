import test from 'node:test';
import assert from 'node:assert/strict';
import {createAmendCoordinator} from '../amend-host.mjs';
import {createCommitCoordinator} from '../commit-host.mjs';
test('identical bindings never allow normal commit and amend tokens to cross',async()=>{
 const person={name:'T',email:'t@x',timestamp:1,timezone:'+0000'},binding={entry:{},repository:{type:'git',root:'/amend-host-independent'},cwd:'/w',assertAuthorized(){}},address={sessionId:'s',repositoryId:'r',committer:person,message:'m'};
 const snapshot={head:'1'.repeat(40),ref:'refs/heads/main',objectFormat:'sha1',indexDigest:'2'.repeat(64),previousTree:'3'.repeat(40),parents:['4'.repeat(40)],author:person,committer:person,message:'m',tree:'5'.repeat(40),commit:{oid:'6'.repeat(40),body:Buffer.from('secret')}};let commits=0,amends=0;
 const api={async prepareCommitPreview(){return snapshot;},async prepareAmendPreview(){return snapshot;},async applyCommitPreview(_,r){commits++;r.onStart();return{};},async applyAmendPreview(_,r){amends++;r.onStart();return{};}};
 const amend=createAmendCoordinator({api}),normal=createCommitCoordinator({api}),a=await amend.prepare(address,binding),c=await normal.prepare({...address,author:person},binding);
 assert.equal(a.action,'amend');assert.deepEqual(a.parents,snapshot.parents);assert.equal(a.previousTree,snapshot.previousTree);assert.equal(JSON.stringify(a).includes('secret'),false);
 await assert.rejects(normal.confirm({sessionId:'s',repositoryId:'r',token:a.token},binding),{code:'vcs/commit-confirmation-invalid'});await assert.rejects(amend.confirm({sessionId:'s',repositoryId:'r',token:c.token},binding),{code:'vcs/amend-confirmation-invalid'});
 await amend.confirm({sessionId:'s',repositoryId:'r',token:a.token},binding);await normal.confirm({sessionId:'s',repositoryId:'r',token:c.token},binding);assert.equal(amends,1);assert.equal(commits,1);
});