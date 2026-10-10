// Own one editor instance; callers own DOM/CSS and decide whether to show fallback.
export function startHistoryEditor({load,node,comparison,key,single=false,onReady=()=>{},onError=()=>{},onComputation=()=>{}}){
 const controller=new AbortController();let instance,closed=false;
 const dispose=()=>{const current=instance;instance=undefined;current?.dispose();};
 const done=Promise.resolve().then(()=>{
  controller.signal.throwIfAborted();
  return load(controller.signal);
 }).then(module=>{
  if(closed)return;
  instance=module.createDiff(node,{single,onComputation:status=>{if(!closed)onComputation(status);}});
  instance.setContent(comparison,key);
  if(!closed)onReady(instance);
 }).catch(error=>{
  try{dispose();}finally{if(!closed)onError(error);}
 });
 return {done,dispose(){if(closed)return;closed=true;controller.abort();dispose();}};
}
