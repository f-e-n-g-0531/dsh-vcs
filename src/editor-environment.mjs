// Share ownership across cache-busted imports of the same editor implementation.
const ownerKey=Symbol.for('dsh-vcs.editor-environment.v1');
export function createEnvironmentOwner(host,createWorker){
 return ()=>{
  let shared=host[ownerKey];
  if(!shared){
   const previous=host.MonacoEnvironment,had=Object.hasOwn(host,'MonacoEnvironment'),workers=new Set();
   const environment={...previous,getWorker(moduleId,label){
    if(label!=='editorWorkerService'){
     if(typeof previous?.getWorker==='function')return previous.getWorker(moduleId,label);
     if(typeof previous?.getWorkerUrl==='function')return createWorker(previous.getWorkerUrl(moduleId,label),label);
     throw Error('Unsupported Monaco worker: '+label);
    }
    const worker=createWorker(undefined,label);workers.add(worker);return worker;
   }};
   shared={previous,had,workers,environment,count:0};host[ownerKey]=shared;host.MonacoEnvironment=environment;
  }
  const state=shared;state.count++;let released=false;
  return ()=>{
   if(released)return;released=true;if(--state.count)return;
   for(const worker of state.workers){try{worker.terminate();}catch{}}
   state.workers.clear();
   if(host.MonacoEnvironment===state.environment){if(state.had)host.MonacoEnvironment=state.previous;else delete host.MonacoEnvironment;}
   if(host[ownerKey]===state)delete host[ownerKey];
  };
 };
}
