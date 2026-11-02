// Browser-only fixture. Import the exact production editor bundle in the caller.
// This is isolated Chrome regression evidence, never an assertion about the current DSH GUI.
const ownerKey = Symbol.for('dsh-vcs.editor-environment.v1');
const pause = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const requiredCount = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) throw Error('Missing/invalid real resource probe: ' + name);
  return value;
};
const summary = values => {
  const sorted=[...values].sort((a,b)=>a-b);
  if(!sorted.length||sorted.some(n=>!Number.isFinite(n)||n<0))throw Error('Invalid browser performance samples');
  return {count:sorted.length,min:sorted[0],max:sorted.at(-1),p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1]};
};

export async function checkPerformance({createDiff,getEditorResources,iterations=100}={}) {
  if(typeof createDiff!=='function'||typeof getEditorResources!=='function')throw Error('createDiff and the production model registry probe are required');
  if(!Number.isSafeInteger(iterations)||iterations<1||iterations>1000)throw Error('Invalid lifecycle iterations');
  const originalWorker=globalThis.Worker,originalEnvironment=globalThis.MonacoEnvironment,originalOwner=globalThis[ownerKey];
  if(typeof originalWorker!=='function')throw Error('Real Worker API required');
  if(originalOwner)throw Error('Run the resource baseline with no active VCS editor owner');
  const liveWorkers=new Set();let workersCreated=0,workersTerminated=0;
  class TrackedWorker extends originalWorker {
    constructor(...args){super(...args);liveWorkers.add(this);workersCreated++;}
    terminate(){const result=super.terminate();if(liveWorkers.delete(this))workersTerminated++;return result;}
  }
  const resources=()=>({models:requiredCount(getEditorResources()?.models,'models'),editorDom:document.querySelectorAll('.monaco-editor').length,ownerCount:requiredCount(globalThis[ownerKey]?.count??0,'ownerCount'),ownedWorkers:requiredCount(globalThis[ownerKey]?.workers?.size??0,'ownedWorkers'),trackedWorkers:liveWorkers.size});
  const initial=resources(),durations=[],modelPeaks=[],workerPeaks=[],heapSamples=[];
  let host,editor;
  const assertRestored=cycle=>{
    const after=resources();
    for(const name of Object.keys(initial))if(after[name]!==initial[name])throw Error('Editor resource retained after cycle '+cycle+': '+name+' '+after[name]+' != '+initial[name]);
    if(globalThis.MonacoEnvironment!==originalEnvironment||globalThis[ownerKey]!==originalOwner)throw Error('Editor global owner was not restored after cycle '+cycle);
    return after;
  };
  const waitFor=async(predicate,label)=>{
    const deadline=performance.now()+10000;
    while(!predicate()){if(performance.now()>deadline)throw Error('Lifecycle operation did not finish: '+label);await pause();}
  };
  globalThis.Worker=TrackedWorker;
  try {
    host=document.createElement('div');host.style.cssText='height:240px;width:800px';host.setAttribute('data-performance-editor','');document.body.appendChild(host);
    for(let i=0;i<iterations;i++){
      const start=performance.now(),single=i%2===1;
      editor=createDiff(host,{single});
      const content=n=>({path:'performance.ts',left:{text:'const value = 1;\n'},right:{text:'const value = '+n+';\n'}});
      editor.setContent(content(i+2),'performance-'+i+'-a');
      await waitFor(()=>{const snap=editor.snapshot();return single?snap?.lengths?.length===1:snap?.computation==='complete';},'first content '+i);
      const first=resources();
      if(first.models<initial.models+(single?1:2))throw Error('Production model probe did not observe active models');
      editor.setContent(content(i+3),'performance-'+i+'-b');
      await waitFor(()=>{const snap=editor.snapshot();return single?snap?.lengths?.length===1:snap?.computation==='complete';},'updated content '+i);
      const active=resources();modelPeaks.push(active.models);workerPeaks.push(active.ownedWorkers);
      if(active.models!==initial.models+(single?1:2))throw Error('Replaced Monaco models remained active at cycle '+i);
      editor.dispose();editor.dispose();
      if(editor.snapshot()!==null)throw Error('Disposed editor still exposes a model snapshot');
      editor=null;await pause();assertRestored(i);durations.push(performance.now()-start);
      const heap=performance.memory?.usedJSHeapSize;if(typeof heap==='number'&&Number.isFinite(heap))heapSamples.push(heap);
    }
    host.remove();host=null;
    const final=assertRestored('final');
    if(liveWorkers.size||workersCreated!==workersTerminated)throw Error('Created workers were not terminated');
    if(workersCreated===0)throw Error('No actual editor worker was observed');
    return {schema:1,kind:'isolated-browser-editor-resources',pass:true,iterations,browser:navigator.userAgent,initial,final,workersCreated,workersTerminated,lifecycleMs:summary(durations),samples:durations,modelPeak:Math.max(initial.models,...modelPeaks),ownedWorkerPeak:Math.max(initial.ownedWorkers,...workerPeaks),heapBytes:heapSamples.length?summary(heapSamples):null,scope:'Production editor create/update/replace/dispose in an isolated browser fixture. Registry model counts and owned-worker termination are checked; heap is observational and no GC/leak or current GUI claim is made. No absolute machine timing budget.'};
  } finally {
    try{editor?.dispose();}finally{
      host?.remove();
      // Do not terminate a leaked worker here: that would disguise a failing production cleanup.
      if(globalThis.Worker===TrackedWorker)globalThis.Worker=originalWorker;
    }
  }
}
