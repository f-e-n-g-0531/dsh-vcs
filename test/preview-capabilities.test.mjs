import test from 'node:test';
import assert from 'node:assert/strict';
import {comparisonPreview,withComparisonPreview} from '../src/preview-capabilities.mjs';

test('comparison capabilities are structural and independent of localized notices',()=>{
 const limits={previewBytes:2097152,largeBytes:8388608};assert.deepEqual(comparisonPreview(),{reason:null,canLoadLarge:false,complete:true,limits});
 const left={text:'',previewReason:'size-limit',notice:'changed arbitrary language'};assert.deepEqual(comparisonPreview({left,allowLarge:true}),{reason:'size-limit',canLoadLarge:true,complete:false,limits});
 assert.equal(comparisonPreview({left,allowLarge:false}).canLoadLarge,false);assert.equal(comparisonPreview({left,allowLarge:true,conflicted:true}).canLoadLarge,false);assert.equal(comparisonPreview({left,allowLarge:true,large:true}).canLoadLarge,false);assert.equal(comparisonPreview({left,right:{largeEligible:false},allowLarge:true}).canLoadLarge,false);
 assert.equal(comparisonPreview({left,right:{binary:true},allowLarge:true}).reason,'binary');assert.equal(comparisonPreview({left:rightOrSpecial(),allowLarge:true}).complete,false);assert.equal(comparisonPreview({left:{notice:'2 MiB'},allowLarge:true}).canLoadLarge,false);
 function rightOrSpecial(){return {previewReason:'unsupported-type',largeEligible:false};}
});

test('comparison wrapper preserves existing fields and adds exact preview shape',()=>{
 const source={large:false,left:{text:'x'},right:{text:'y'},notice:'existing notice',path:'a'};const result=withComparisonPreview(source,{allowLarge:true});assert.equal(result.notice,source.notice);assert.equal(result.left,source.left);assert.deepEqual(Object.keys(result.preview).sort(),['canLoadLarge','complete','limits','reason']);assert.equal(result.preview.complete,true);
});
