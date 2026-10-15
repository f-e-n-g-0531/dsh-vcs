import test from 'node:test';import assert from 'node:assert/strict';import {mergeSvnHistoryWindow} from '../src/svn-history-window.mjs';
test('SVN uses same bounded append window as Git without converting revision strings',()=>{
 let page=null;for(let offset=0;offset<350;offset+=50){const entries=Array.from({length:50},(_,i)=>({revision:String(9223372036854775807n-BigInt(offset+i)),message:'row'}));page=mergeSvnHistoryWindow(page,{snapshot:'9223372036854775807',entries,nextRevision:entries.at(-1).revision},offset);assert.equal(page.entries.length,Math.min(offset+50,200));assert.equal(page.windowEnd,offset+50);assert.equal(page.snapshot,'9223372036854775807');}
 assert.equal(page.entries[0].revision,String(9223372036854775807n-150n));
 const reset=mergeSvnHistoryWindow(page,{entries:[{revision:'9'}],nextRevision:null},0);assert.deepEqual(reset.entries,[{revision:'9'}]);
});
