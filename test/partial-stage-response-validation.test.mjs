import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const bundled=await build({entryPoints:['src/PartialStage.jsx'],bundle:true,write:false,platform:'node',format:'cjs',external:['react']});const module={exports:{}};vm.runInNewContext(Buffer.from(bundled.outputFiles[0].contents).toString(),{module,exports:module.exports,require:createRequire(import.meta.url),Date,Set,Map,Object,Number,JSON,Error});const {validatePartialPlan}=module.exports;
function fixture(){return {action:'partial-stage',path:'a',head:'a'.repeat(40),index:{oid:'b'.repeat(40),mode:'100644'},planToken:'c'.repeat(64),expiresAt:Date.now()+59000,plan:{id:'d'.repeat(64),algorithm:'raw-line-lcs-v1',beforeHash:'e'.repeat(64),afterHash:'f'.repeat(64),beforeBytes:2,afterBytes:2,beforeLineCount:1,afterLineCount:1,lcsCells:4,units:[{id:'1'.repeat(64),beforeStart:0,beforeCount:1,afterStart:0,afterCount:1,before:[{text:'a',terminator:'LF'}],after:[{text:'b',terminator:'LF'}]}]}};}
test('partial plan response refuses trailing token or OID line terminators',()=>{for(const patch of [{planToken:'c'.repeat(64)+'\n'},{head:'a'.repeat(40)+'\n'}])assert.throws(()=>validatePartialPlan({...fixture(),...patch}));});
test('partial plan response bounds changed text and raw terminator metadata',()=>{validatePartialPlan(fixture());for(const mutate of [p=>p.plan.units[0].after[0].text='x'.repeat(262145),p=>p.plan.units[0].after[0].terminator='BAD',p=>p.plan.units[0].after[0].terminator=['LF'],p=>p.plan.units[0].after[0].terminator=['NONE'],p=>p.plan.units[0].afterCount=4001,p=>p.plan.units.push(p.plan.units[0])]){const p=fixture();mutate(p);assert.throws(()=>validatePartialPlan(p));}});
