import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdtemp,mkdir,writeFile,readFile,rm,link,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {summarizeSamples,counterDelta,summarizeMeasurements,validatePerformanceReport,comparePerformanceReports,fixtureConfiguration,isSafeFixtureDirectory,parsePerformanceArguments,assertDistinctReportPaths,performanceCli} from '../scripts/performance-baseline.mjs';

const measurement = durationMs => ({durationMs,rssPeakBytes:100,blobReads:0,blobReadBytes:0,decodeCount:0,cacheHits:2});
function report(duration=10){
  const samples=[measurement(duration)],phase=()=>({samples:structuredClone(samples),summary:summarizeMeasurements(samples)});
  return {schema:1,kind:'synthetic-git-performance',environment:{node:'v24',git:'git 2',platform:'test',arch:'test',cpu:'fixed',logicalCpus:4,totalMemoryBytes:1024},fixture:{entries:10,largeBytes:100,smallBytes:10,totalBytes:260,pageSize:10,sha256:'a'.repeat(64)},iterations:1,scenarios:Object.fromEntries(['pointFile','directoryPage','segmentedFile'].map(name=>[name,{cold:phase(),warm:phase()}]))};
}

test('performance nearest-rank statistics retain zeros and do not mutate input',()=>{
  const values=[10,1,8,5,0,2,9,4,7,3],before=[...values];
  assert.deepEqual(summarizeSamples(values),{count:10,min:0,max:10,mean:4.9,p50:4,p95:10});assert.deepEqual(values,before);
  assert.deepEqual(summarizeSamples([0]),{count:1,min:0,max:0,mean:0,p50:0,p95:0});
  assert.equal(summarizeSamples([Number.MAX_VALUE,Number.MAX_VALUE]).mean,Number.MAX_VALUE);
});
test('performance rejects absent nonfinite negative and coerced samples',()=>{
  for(const samples of [[],null,[NaN],[Infinity],[-1],['1'],[undefined]])assert.throws(()=>summarizeSamples(samples));
  assert.throws(()=>summarizeMeasurements([{}]),/metric/);
  assert.throws(()=>summarizeSamples(new Array(2)),/metric/);
});
test('cache counter deltas reject missing data resets and nonfinite values',()=>{
  const before={blobReads:1,blobReadBytes:8,decodeCount:1,cacheHits:0},after={blobReads:2,blobReadBytes:16,decodeCount:2,cacheHits:10};
  assert.deepEqual(counterDelta(before,after),{blobReads:1,blobReadBytes:8,decodeCount:1,cacheHits:10});
  assert.throws(()=>counterDelta(before,{}));assert.throws(()=>counterDelta(after,before),/reset/);assert.throws(()=>counterDelta(before,{...after,cacheHits:NaN}));
});
test('performance report validates raw sample coverage and computed summaries',()=>{
  assert.equal(validatePerformanceReport(report()).schema,1);
  const missing=report();delete missing.scenarios.segmentedFile;assert.throws(()=>validatePerformanceReport(missing),/Missing samples/);
  const forged=report();forged.scenarios.pointFile.warm.summary.durationMs.p95=0;assert.throws(()=>validatePerformanceReport(forged),/does not match/);
  const invalid=report();invalid.scenarios.pointFile.warm.samples[0].blobReadBytes=NaN;assert.throws(()=>validatePerformanceReport(invalid),/metric/);
  const count=report();count.iterations=2;assert.throws(()=>validatePerformanceReport(count),/Missing samples/);
});
test('comparison only budgets explicitly and reports same-fixture regression',()=>{
  const baseline=report(),current=report(13);
  assert.equal(comparePerformanceReports(baseline,current).pass,true);
  const result=comparePerformanceReports(baseline,current,{maxRatio:1.2,strict:true});
  assert.equal(result.pass,false);assert.equal(result.regressions.length,6);assert.equal(result.regressions[0].ratio,1.3);
  assert.throws(()=>comparePerformanceReports(baseline,current,{strict:true}),/explicit/);
  assert.throws(()=>comparePerformanceReports(baseline,current,{maxRatio:NaN}),/maxRatio/);
});
test('comparison rejects incompatible tools fixture counts and omitted metrics',()=>{
  for(const field of ['node','git','platform','arch','cpu']){const current=report();current.environment[field]='different';assert.throws(()=>comparePerformanceReports(report(),current),/Environment mismatch/);}
  for(const field of ['logicalCpus','totalMemoryBytes']){const current=report();current.environment[field]++;assert.throws(()=>comparePerformanceReports(report(),current),/Environment mismatch/);}
  for(const field of ['entries','largeBytes','smallBytes','totalBytes','pageSize','sha256']){const current=report();current.fixture[field]=field==='sha256'?'b'.repeat(64):current.fixture[field]+1;assert.throws(()=>comparePerformanceReports(report(),current),/Fixture mismatch/);}
  const current=report();delete current.scenarios.pointFile.cold.summary.rssPeakBytes;assert.throws(()=>comparePerformanceReports(report(),current),/metric/);
});
test('zero baseline does not serialize Infinity and extra work is a regression',()=>{
  const baseline=report(0),current=report(1);const result=comparePerformanceReports(baseline,current,{maxRatio:1.1});
  assert.equal(result.regressions[0].ratio,null);assert.doesNotThrow(()=>JSON.stringify(result));
  assert.equal(comparePerformanceReports(baseline,baseline,{maxRatio:1.1}).pass,true);
});
test('fixture limits are explicit and cleanup accepts only fresh direct temp children',()=>{
  assert.deepEqual(fixtureConfiguration(),{entries:10000,largeBytes:4194304,pageSize:100});
  for(const options of [{entries:0},{entries:100001},{largeBytes:16777217},{pageSize:101},{largeBytes:1.5}])assert.throws(()=>fixtureConfiguration(options));
  const root=path.resolve('temporary-root');assert.equal(isSafeFixtureDirectory(path.join(root,'dsh-vcs-performance-ABC123'),root),true);
  for(const target of [root,path.dirname(root),path.join(root,'unrelated'),path.join(root,'nested','dsh-vcs-performance-ABC123'),path.join(root,'dsh-vcs-performance-')])assert.equal(isSafeFixtureDirectory(target,root),false);
});
test('CLI defaults to ten warm runs and requires deliberate strict budget',()=>{
  const defaults=parsePerformanceArguments([]);assert.equal(defaults.iterations,10);assert.equal(defaults.maxRatio,null);assert.equal(defaults.strict,false);assert.equal(defaults.output,'test-results/performance/baseline.json');
  assert.equal(parsePerformanceArguments(['--baseline','old.json','--max-ratio','1.2','--strict']).strict,true);
  assert.throws(()=>parsePerformanceArguments(['--strict']),/requires/);
  for(const args of [['--unknown'],['--iterations'],['--iterations','NaN'],['--iterations','1.5'],['--max-ratio','0.5']])assert.throws(()=>parsePerformanceArguments(args));
});

test('CLI refuses overwrite before benchmarking, including normalized paths',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-performance-paths-'));
 try{
  const dir=path.join(root,'test-results/performance');await mkdir(dir,{recursive:true});
  const baseline=path.join(dir,'baseline.json'),original=JSON.stringify(report());await writeFile(baseline,original);
  let runs=0;
  const deps={cwd:root,runBaseline:async()=>{runs++;return report(13);},log:()=>{}};
  await assert.rejects(performanceCli(['--baseline',baseline,'--strict','--max-ratio','1.2'],deps),/overwrite baseline/);
  await assert.rejects(assertDistinctReportPaths(baseline,path.join(dir,'..','performance','baseline.json')),/overwrite baseline/);
  assert.equal(runs,0);assert.equal(await readFile(baseline,'utf8'),original);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('realpath directory aliases and hardlinks cannot overwrite baseline',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-performance-alias-'));
 try{
  const dir=path.join(root,'actual');await mkdir(dir);const baseline=path.join(dir,'baseline.json');await writeFile(baseline,'baseline');
  const hard=path.join(dir,'hard.json');await link(baseline,hard);
  await assert.rejects(assertDistinctReportPaths(baseline,hard),/overwrite baseline/);
  const alias=path.join(root,'alias');await symlink(dir,alias,process.platform==='win32'?'junction':'dir');
  await assert.rejects(assertDistinctReportPaths(baseline,path.join(alias,'baseline.json')),/overwrite baseline/);
  await assertDistinctReportPaths(baseline,path.join(alias,'new.json'));
  assert.equal(await readFile(baseline,'utf8'),'baseline');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('strict regression writes distinct current report and preserves baseline bytes',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'vcs-performance-strict-'));
 try{
  const dir=path.join(root,'test-results/performance');await mkdir(dir,{recursive:true});
  const baseline=path.join(dir,'baseline.json'),original=JSON.stringify(report());await writeFile(baseline,original);
  let exit=0;
  const result=await performanceCli(['--baseline',baseline,'--output','test-results/performance/current.json','--max-ratio','1.2','--strict'],{cwd:root,runBaseline:async()=>report(13),log:()=>{},setExitCode:code=>{exit=code;}});
  assert.equal(result.comparison.pass,false);assert.equal(exit,1);
  assert.equal(await readFile(baseline,'utf8'),original);
  assert.equal(JSON.parse(await readFile(path.join(dir,'current.json'),'utf8')).comparison.pass,false);
 }finally{await rm(root,{recursive:true,force:true});}
});
