import test from 'node:test';
import assert from 'node:assert/strict';
import {validateLayoutReport} from '../scripts/layout-report.mjs';
const fixture=()=>({browser:'Test Chrome',results:['zh','en'].flatMap(lang=>[180,260].flatMap(width=>[1,1.25,2].map(zoom=>({case:lang+' / '+width+'px / CSS zoom '+zoom,pass:true,inside:true,overlap:false,renameHit:true}))))});
test('accepts exactly the full browser layout matrix',()=>{const report=fixture();assert.equal(validateLayoutReport(report),report);});
for(const [name,mutate] of [
 ['missing case',r=>r.results.pop()],
 ['duplicate case',r=>r.results[1]={...r.results[0]}],
 ['unknown case',r=>r.results[0].case='unexpected'],
 ['no browser',r=>r.browser=''],
 ['not array',r=>r.results={}],
 ['string pass',r=>r.results[0].pass='true'],
 ['outside despite pass',r=>r.results[0].inside=false],
 ['overlap despite pass',r=>r.results[0].overlap=true],
 ['occluded despite pass',r=>r.results[0].renameHit=false],
 ['missing row',r=>r.results[0]=null],
])test('rejects '+name,()=>{const report=fixture();mutate(report);assert.throws(()=>validateLayoutReport(report));});
