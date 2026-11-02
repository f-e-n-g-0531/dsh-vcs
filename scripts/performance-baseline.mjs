import {spawnSync} from 'node:child_process';
import {mkdtemp, realpath, rm, mkdir, writeFile, readFile, lstat, stat} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const COUNTERS = ['blobReads','blobReadBytes','decodeCount','cacheHits'];
const SCENARIOS = ['pointFile','directoryPage','segmentedFile'];
const METRICS = ['durationMs','rssPeakBytes','blobReads','blobReadBytes','decodeCount','cacheHits'];
const finite = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error('Invalid nonnegative metric: ' + label);
  return value;
};
const integer = (value, min, max, label) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error('Invalid ' + label);
  return value;
};

/** Nearest-rank quantile. Never coerce missing values, strings, NaN or Infinity. */
export function summarizeSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw Error('At least one sample is required');
  const sorted = Array.from(samples, (n, i) => finite(n, 'sample[' + i + ']')).sort((a,b) => a-b);
  const quantile = p => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
  const total = sorted.reduce((sum,n) => sum+n,0);
  const mean = Number.isFinite(total) ? total/sorted.length : sorted.reduce((average,n) => average+n/sorted.length,0);
  return {count: sorted.length, min: sorted[0], max: sorted.at(-1), mean, p50: quantile(0.5), p95: quantile(0.95)};
}

export function counterDelta(before, after) {
  return Object.fromEntries(COUNTERS.map(key => {
    const start = finite(before?.[key], key + '.before'), end = finite(after?.[key], key + '.after');
    if (end < start) throw Error('Counter reset during sample: ' + key);
    return [key, end-start];
  }));
}

export function summarizeMeasurements(samples) {
  if (!Array.isArray(samples) || !samples.length) throw Error('Measurements must not be empty');
  return Object.fromEntries(METRICS.map(key => [key, summarizeSamples(samples.map(sample => finite(sample?.[key], key)))]));
}

export function validatePerformanceReport(report) {
  if (!report || report.schema !== 1 || report.kind !== 'synthetic-git-performance') throw Error('Unsupported performance report');
  for (const key of ['node','git','platform','arch','cpu']) if (typeof report.environment?.[key] !== 'string' || !report.environment[key]) throw Error('Missing environment: ' + key);
  for (const key of ['logicalCpus','totalMemoryBytes']) integer(report.environment[key], 1, Number.MAX_SAFE_INTEGER, 'environment.' + key);
  for (const key of ['entries','largeBytes','smallBytes','totalBytes','pageSize']) integer(report.fixture?.[key], 1, Number.MAX_SAFE_INTEGER, 'fixture.' + key);
  if (!/^[a-f0-9]{64}$/.test(report.fixture.sha256 || '')) throw Error('Missing fixture sha256');
  integer(report.iterations, 1, 100, 'iterations');
  for (const name of SCENARIOS) {
    const scenario = report.scenarios?.[name];
    for (const phase of ['cold','warm']) {
      const phaseSamples = scenario?.[phase]?.samples;
      if (!Array.isArray(phaseSamples) || phaseSamples.length !== (phase === 'cold' ? 1 : report.iterations)) throw Error('Missing samples: ' + name + '.' + phase);
      const actual = summarizeMeasurements(phaseSamples);
      for (const key of METRICS) for (const stat of ['count','min','max','mean','p50','p95']) {
        const stored = finite(scenario[phase].summary?.[key]?.[stat], name + '.' + phase + '.' + key + '.' + stat);
        if (stored !== actual[key][stat]) throw Error('Summary does not match samples: ' + name + '.' + phase + '.' + key);
      }
    }
  }
  return report;
}

/** Compare only matched fixture/tool environments; no machine-specific time limit is built in. */
export function comparePerformanceReports(baseline, current, {maxRatio = null, strict = false} = {}) {
  validatePerformanceReport(baseline); validatePerformanceReport(current);
  if (strict && maxRatio === null) throw Error('Strict comparison requires an explicit maxRatio');
  if (maxRatio !== null && (typeof maxRatio !== 'number' || !Number.isFinite(maxRatio) || maxRatio < 1)) throw Error('Invalid maxRatio');
  for (const key of ['node','git','platform','arch','cpu','logicalCpus','totalMemoryBytes']) if (baseline.environment[key] !== current.environment[key]) throw Error('Environment mismatch: ' + key);
  for (const key of ['entries','largeBytes','smallBytes','totalBytes','pageSize','sha256']) if (baseline.fixture[key] !== current.fixture[key]) throw Error('Fixture mismatch: ' + key);
  if (baseline.iterations !== current.iterations) throw Error('Iteration count mismatch');
  const comparisons = [];
  for (const scenario of SCENARIOS) for (const phase of ['cold','warm']) for (const metric of METRICS) {
    const before = baseline.scenarios[scenario][phase].summary[metric].p95;
    const after = current.scenarios[scenario][phase].summary[metric].p95;
    const quotient = before === 0 ? (after === 0 ? 1 : null) : after/before;
    const ratio = quotient === null || !Number.isFinite(quotient) ? null : quotient;
    // Cache hits are useful work, not an expense; report their ratio without a regression budget.
    const regressed = metric !== 'cacheHits' && maxRatio !== null && (before === 0 ? after > 0 : after > before * maxRatio);
    comparisons.push({scenario,phase,metric,baselineP95:before,currentP95:after,ratio,regressed});
  }
  const regressions = comparisons.filter(item => item.regressed);
  return {pass: regressions.length === 0, strict, maxRatio, regressions, comparisons};
}

function gitEnvironment() {
  return {...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT:'0', GIT_OPTIONAL_LOCKS:'0', GIT_ALLOW_PROTOCOL:'', GIT_NO_LAZY_FETCH:'1'};
}
function runGit(root, args, input) {
  const result = spawnSync('git', ['-c','core.autocrlf=false','-c','core.fsmonitor=false',...(root ? ['-C',root] : []),...args], {input,encoding:'utf8',windowsHide:true,shell:false,env:gitEnvironment(),timeout:120000,maxBuffer:64*1024*1024});
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Git fixture command failed (' + result.status + '): ' + args[0] + ': ' + result.stderr);
  return result.stdout.trim();
}

export function fixtureConfiguration({entries = 10000, largeBytes = 4 * 1024 * 1024, pageSize = 100} = {}) {
  integer(entries, 1, 100000, 'entries'); integer(largeBytes, 1, 16 * 1024 * 1024, 'largeBytes'); integer(pageSize,1,100,'pageSize');
  return {entries,largeBytes,pageSize};
}

/** Only a fresh, direct child of the canonical OS temp directory can be removed. */
export function isSafeFixtureDirectory(directory, tempRoot) {
  const resolved = path.resolve(directory), parent = path.resolve(tempRoot);
  return path.dirname(resolved) === parent && /^dsh-vcs-performance-[A-Za-z0-9]+$/.test(path.basename(resolved));
}

export async function withSyntheticGitFixture(options, callback) {
  const config = fixtureConfiguration(options);
  if (typeof callback !== 'function') throw Error('Fixture callback required');
  const tempRoot = await realpath(os.tmpdir());
  const directory = await mkdtemp(path.join(tempRoot,'dsh-vcs-performance-'));
  if (!isSafeFixtureDirectory(directory,tempRoot)) throw Error('Refusing unexpected temporary fixture path: ' + directory);
  const root = await realpath(directory);
  try {
    runGit(root,['init','-q']);
    const small = Buffer.from('fixture small UTF-8 中文\n');
    const line = Buffer.from('0123456789 中文 fixture line\n');
    const large = Buffer.alloc(config.largeBytes, 32);
    for (let offset = 0; offset + line.length <= large.length; offset += line.length) line.copy(large,offset);
    const chunks = [Buffer.from('commit refs/heads/performance\nauthor Performance <performance@example.invalid> 1700000000 +0000\ncommitter Performance <performance@example.invalid> 1700000000 +0000\ndata 19\nperformance fixture\n')];
    const hash = createHash('sha256'); let totalBytes = 0;
    const add = (file, data) => {
      chunks.push(Buffer.from('M 100644 inline ' + file + '\ndata ' + data.length + '\n'),data,Buffer.from('\n'));
      hash.update(file + '\0'); hash.update(data); totalBytes += data.length;
    };
    add('small.txt',small); add('large.txt',large);
    const record = Buffer.from('synthetic entry\n');
    for (let i=0;i<config.entries;i++) add('files/f' + String(i).padStart(6,'0') + '.txt',record);
    chunks.push(Buffer.from('\ndone\n'));
    runGit(root,['fast-import','--quiet'],Buffer.concat(chunks));
    const commit = runGit(root,['rev-parse','refs/heads/performance']);
    const fixture = {...config,smallBytes:small.length,totalBytes,sha256:hash.digest('hex'),largeSha256:createHash('sha256').update(large).digest('hex')};
    return await callback({root,commit,fixture,smallText:small.toString('utf8')});
  } finally {
    // Re-resolve and reject replacement/link tricks rather than delete an unverified path.
    if (!isSafeFixtureDirectory(root,tempRoot) || (await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw Error('Refusing unsafe fixture cleanup: ' + root);
    await rm(root,{recursive:true,force:true,maxRetries:5});
  }
}

async function measure(operation, cacheStats) {
  const before = cacheStats(); let rssPeakBytes = process.memoryUsage().rss;
  const observe = () => {rssPeakBytes=Math.max(rssPeakBytes,process.memoryUsage().rss);};
  const timer = setInterval(observe,5), started = performance.now();
  try {
    await operation(); observe();
    return {durationMs:performance.now()-started,rssPeakBytes,...counterDelta(before,cacheStats())};
  } finally {clearInterval(timer);}
}

export async function runPerformanceBaseline({iterations = 10, entries = 10000, largeBytes = 4*1024*1024, pageSize = 100, adapter} = {}) {
  integer(iterations,1,100,'iterations');
  const api = adapter || await import('../vcs.mjs');
  for (const name of ['getHistoricalFile','getHistoricalTreePage','getHistoricalSegment','historicalCacheStats','clearHistoricalCache']) if (typeof api[name] !== 'function') throw Error('Performance API unavailable: ' + name);
  return withSyntheticGitFixture({entries,largeBytes,pageSize},async({root,commit,fixture,smallText}) => {
    const repo = {root,type:'git'};
    const operations = {
      pointFile: async() => {const result=await api.getHistoricalFile(repo,{commit,path:'small.txt'});if(result.text!==smallText)throw Error('Small fixture preview mismatch');},
      directoryPage: async() => {const result=await api.getHistoricalTreePage(repo,{commit,path:'files',offset:0,limit:pageSize});if(result.entries.length!==Math.min(entries,pageSize)||result.entries.some(row=>!row.path.startsWith('files/')))throw Error('Directory fixture page mismatch');},
      segmentedFile: async() => {
        let offset=0,total=0,segments=0;const hash=createHash('sha256');
        do {
          const result=await api.getHistoricalSegment(repo,{commit,path:'large.txt',offset});
          const bytes=Buffer.from(result.text,'utf8');
          if(result.offset!==offset||bytes.length>65536||result.totalBytes!==fixture.largeBytes||result.endOffset!==offset+bytes.length)throw Error('Segment fixture framing mismatch');
          hash.update(bytes);total+=bytes.length;segments++;
          if(result.nextOffset!==null&&(!Number.isInteger(result.nextOffset)||result.nextOffset<=offset))throw Error('Segment cursor did not advance');
          offset=result.nextOffset;
          if(segments>Math.ceil(fixture.largeBytes/65532)+1)throw Error('Too many fixture segments');
        }while(offset!==null);
        if(total!==fixture.largeBytes||hash.digest('hex')!==fixture.largeSha256)throw Error('Segment fixture content mismatch');
      },
    };
    const scenarios={};
    try {
      for(const name of SCENARIOS){
        api.clearHistoricalCache(root);
        const cold=[await measure(operations[name],api.historicalCacheStats)];
        const warm=[];for(let i=0;i<iterations;i++)warm.push(await measure(operations[name],api.historicalCacheStats));
        scenarios[name]={cold:{samples:cold,summary:summarizeMeasurements(cold)},warm:{samples:warm,summary:summarizeMeasurements(warm)}};
      }
      const report={schema:1,kind:'synthetic-git-performance',createdAt:new Date().toISOString(),environment:{node:process.version,git:runGit(null,['--version']),platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model||'unknown',logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem()},fixture,iterations,scenarios,scope:'Direct read-only adapter against a disposable local Git object fixture; cold means empty plugin blob cache, not cold OS disk cache. Cold has one observation; warm defaults to ten subsequent full traversals, without resetting or extending the production cache TTL (cache expiry remains observable). blobReads/blobReadBytes/decodeCount/cacheHits count the historical segmented-blob cache only, not small-file or tree command I/O. RSS is sampled Node-process resident memory, not child-process RSS or an allocator leak verdict. No GUI, network, install or build is exercised.'};
      return validatePerformanceReport(report);
    } finally {api.clearHistoricalCache(root);}
  });
}

export function parsePerformanceArguments(args) {
  const options={iterations:10,entries:10000,largeBytes:4*1024*1024,pageSize:100,output:'test-results/performance/baseline.json',baseline:null,strict:false,maxRatio:null,stdout:false,help:false};
  const numeric=new Map([['--iterations','iterations'],['--entries','entries'],['--large-bytes','largeBytes'],['--page-size','pageSize'],['--max-ratio','maxRatio']]);
  const text=new Map([['--output','output'],['--baseline','baseline']]);
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--strict')options.strict=true;
    else if(arg==='--stdout')options.stdout=true;
    else if(arg==='--help')options.help=true;
    else if(numeric.has(arg)||text.has(arg)){
      const value=args[++i];if(!value||value.startsWith('--'))throw Error('Missing option value: '+arg);
      if(numeric.has(arg)){if(!/^(?:\d+)(?:\.\d+)?$/.test(value))throw Error('Invalid numeric option: '+arg);options[numeric.get(arg)]=Number(value);}
      else options[text.get(arg)]=value;
    }else throw Error('Unknown option: '+arg);
  }
  integer(options.iterations,1,100,'iterations');fixtureConfiguration(options);
  if(options.strict&&(!options.baseline||options.maxRatio===null))throw Error('--strict requires --baseline and --max-ratio');
  if(options.maxRatio!==null&&(!Number.isFinite(options.maxRatio)||options.maxRatio<1))throw Error('Invalid maxRatio');
  if(!options.stdout&&options.baseline&&path.resolve(options.baseline)===path.resolve(options.output))throw Error('Performance output must not overwrite baseline');
  return options;
}

async function canonicalDestination(file) {
  try {return await realpath(file);} catch(error) {
    if(error.code!=='ENOENT')throw error;
    const parent=path.dirname(file);
    if(parent===file)throw error;
    return path.join(await canonicalDestination(parent),path.basename(file));
  }
}

export async function assertDistinctReportPaths(baseline,output,{cwd=process.cwd()}={}) {
  const input=path.resolve(cwd,baseline),target=path.resolve(cwd,output);
  const [canonicalInput,canonicalOutput]=await Promise.all([realpath(input),canonicalDestination(target)]);
  if(canonicalInput===canonicalOutput)throw Error('Performance output must not overwrite baseline');
  const source=await stat(input);
  try {
    const destination=await stat(target);
    if(source.dev===destination.dev&&source.ino===destination.ino)throw Error('Performance output must not overwrite baseline alias');
  }catch(error){if(error.code!=='ENOENT')throw error;}
}

async function writeReport(report, destination, {cwd=process.cwd(),baseline}={}) {
  const base=path.resolve(cwd,'test-results/performance'),target=path.resolve(cwd,destination);
  if(path.dirname(target)!==base||path.extname(target)!=='.json'||path.basename(target).startsWith('.'))throw Error('Output must be a direct .json child of test-results/performance');
  const workspace=await realpath(cwd);
  // All created output ancestors must remain within this workspace, including existing links.
  for(const component of [path.resolve(cwd,'test-results'),base]){
    try {const stat=await lstat(component);if(stat.isSymbolicLink()||!(await realpath(component)).startsWith(workspace+path.sep))throw Error('Unsafe output directory');}
    catch(error){if(error.code!=='ENOENT')throw error;await mkdir(component);}
  }
  try {if((await lstat(target)).isSymbolicLink())throw Error('Refusing linked performance output');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(baseline)await assertDistinctReportPaths(baseline,target,{cwd});
  await writeFile(target,JSON.stringify(report,null,2)+'\n');return target;
}

export async function performanceCli(args = process.argv.slice(2), {cwd=process.cwd(),runBaseline=runPerformanceBaseline,log=console.log,setExitCode=code=>{process.exitCode=code;}}={}) {
  const options=parsePerformanceArguments(args);
  if(options.help){console.log('node scripts/performance-baseline.mjs [--iterations 10] [--entries 10000] [--large-bytes 4194304] [--page-size 100] [--output test-results/performance/baseline.json | --stdout] [--baseline prior.json --max-ratio 1.2 --strict]');return null;}
  if(options.baseline&&!options.stdout)await assertDistinctReportPaths(options.baseline,options.output,{cwd});
  const baseline=options.baseline?validatePerformanceReport(JSON.parse(await readFile(path.resolve(cwd,options.baseline),'utf8'))):null;
  const report=await runBaseline(options);
  if(baseline)report.comparison=comparePerformanceReports(baseline,report,options);
  if(options.stdout)log(JSON.stringify(report,null,2));else log('Performance report: '+await writeReport(report,options.output,{cwd,baseline:options.baseline}));
  if(options.strict&&!report.comparison.pass)setExitCode(1);
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))performanceCli().catch(error=>{console.error(error.stack||String(error));process.exitCode=1;});
