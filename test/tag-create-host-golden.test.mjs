import test from 'node:test';
import assert from 'node:assert/strict';
import {createTagCreateCoordinator} from '../tag-create-host.mjs';
import {createBranchCreateCoordinator} from '../branch-create-host.mjs';
test('tag coordinator keeps private body and target despite public mutation and cross-kind token',async()=>{
 const tagger={name:'T',email:'t@x',timestamp:1,timezone:'+0000'},snapshot={name:'release',ref:'refs/tags/release',objectFormat:'sha1',head:'1'.repeat(40),currentRef:'refs/heads/main',targetTree:'2'.repeat(40),tagger,message:'EOF',messageBytes:3,object:{oid:'3'.repeat(40),body:Buffer.from('private')},planId:'4'.repeat(64)};
 const binding={entry:{},repository:{type:'git',root:'/tag-host-golden'},cwd:'/w',assertAuthorized(){}},address={sessionId:'s',repositoryId:'r'};let selected;
 const api={async prepareTagCreate(){return snapshot;},async applyTagCreate(_,r){selected=r.snapshot;r.onStart();return{};},async prepareBranchCreate(){return {name:'topic',ref:'refs/heads/topic',target:{oid:snapshot.head},head:snapshot.head,currentRef:snapshot.currentRef,objectFormat:'sha1'};},async applyBranchCreate(_,r){r.onStart();return{};}};
 const tags=createTagCreateCoordinator({api}),branches=createBranchCreateCoordinator({api}),t=await tags.prepare({...address,name:'release',tagger,message:'EOF'},binding),b=await branches.prepare({...address,name:'topic'},binding);
 await assert.rejects(tags.confirm({...address,token:b.token},binding),{code:'vcs/tag-create-confirmation-invalid'});t.tagger.name='evil';t.object.oid='5'.repeat(40);assert.equal(Object.hasOwn(t.object,'body'),false);await tags.confirm({...address,token:t.token},binding);assert.strictEqual(selected,snapshot);assert.equal(selected.tagger.name,'T');assert.equal(selected.object.oid,'3'.repeat(40));await branches.confirm({...address,token:b.token},binding);
});
