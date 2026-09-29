// One worker environment per bundle, retained until the last editor releases it.
export function createEnvironmentOwner(host,createWorker){
 let shared;
 return ()=>{
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
   shared={previous,had,workers,environment,count:0};host.MonacoEnvironment=environment;
  }
  const state=shared;state.count++;let released=false;
  return ()=>{
   if(released)return;released=true;if(--state.count)return;
   for(const worker of state.workers){try{worker.terminate();}catch{}}
   state.workers.clear();
   if(host.MonacoEnvironment===state.environment){if(state.had)host.MonacoEnvironment=state.previous;else delete host.MonacoEnvironment;}
   shared=undefined;
  };
 };
}
