import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeFileHistoryWindow,previousHistoryOffset} from '../src/history-pages.mjs';
const page=offset=>({path:'f',commits:Array.from({length:50},(_,i)=>({id:String(offset+i)})),nextOffset:offset+50});
test('file history retains at most 200 rows and back refetch replaces a window',()=>{
 let state={commits:[]};for(let offset=0;offset<=300;offset+=50)state=mergeFileHistoryWindow(state,page(offset),offset);
 assert.equal(state.commits.length,200);assert.equal(state.commits[0].id,'150');assert.equal(state.windowStart,150);
 const back=mergeFileHistoryWindow(state,page(250),250);
 assert.equal(back.commits.length,50);assert.equal(back.commits[0].id,'250');assert.equal(back.nextOffset,300);
 assert.equal(previousHistoryOffset(300),250);assert.equal(previousHistoryOffset(0),0);
});
test('sparse pages follow authoritative nextOffset rather than row count',()=>{
 const first=mergeFileHistoryWindow({commits:[]},{commits:[{id:'first'}],nextOffset:50},0);
 const second=mergeFileHistoryWindow(first,{commits:[{id:'second'}],nextOffset:null},50);
 assert.deepEqual(second.commits.map(r=>r.id),['first','second']);assert.equal(second.nextOffset,null);
});
test('retried pages deduplicate without mutating old state',()=>{
 const old=mergeFileHistoryWindow({commits:[]},page(0),0),next=mergeFileHistoryWindow(old,page(50),50);
 const retry=mergeFileHistoryWindow(next,page(50),50);
 assert.equal(old.commits.length,50);assert.equal(next.commits.length,100);assert.equal(retry.commits.length,50);
 assert.equal(new Set(retry.commits.map(r=>r.id)).size,retry.commits.length);
});
