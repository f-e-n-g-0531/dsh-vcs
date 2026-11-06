import test from 'node:test';
import assert from 'node:assert/strict';
import {createBranchCreateCoordinator} from '../branch-create-host.mjs';
import {createCommitCoordinator} from '../commit-host.mjs';
test('branch create public tampering and commit token cannot change private fixed target',async()=>{
 const binding={entry:{},repository:{type:'git',root:'/branch-host-independent'},cwd:'/w',assertAuthorized(){}},address={sessionId:'s',repositoryId:'r',name:'topic'},person={name:'T',email:'t@x',timestamp:1,timezone:'+0000'},snapshot={action:'branch-create',name:'topic',ref:'refs/heads/topic',target:{oid:'1'.repeat(40)},head:'1'.repeat(40),currentRef:'refs/heads/main',objectFormat:'sha1'};let selected;
 const api={async prepareBranchCreate(){return snapshot;},async applyBranchCreate(_,r){selected=r.snapshot;r.onStart();return{};},async prepareCommitPreview(){return {head:'1'.repeat(40),ref:'refs/heads/main',objectFormat:'sha1',indexDigest:'2'.repeat(64),tree:'3'.repeat(40),commit:{oid:'4'.repeat(40)},author:person,committer:person,message:'m'};},async applyCommitPreview(_,r){r.onStart();return{};}};
 const branch=createBranchCreateCoordinator({api}),commit=createCommitCoordinator({api}),b=await branch.prepare(address,binding),c=await commit.prepare({sessionId:'s',repositoryId:'r',author:person,committer:person,message:'m'},binding);
 await assert.rejects(branch.confirm({sessionId:'s',repositoryId:'r',token:c.token},binding),{code:'vcs/branch-create-confirmation-invalid'});b.target.oid='5'.repeat(40);b.ref='refs/heads/evil';await branch.confirm({sessionId:'s',repositoryId:'r',token:b.token},binding);assert.strictEqual(selected,snapshot);assert.equal(selected.target.oid,'1'.repeat(40));await commit.confirm({sessionId:'s',repositoryId:'r',token:c.token},binding);
});