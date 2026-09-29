// Decide without changing the event; callers preventDefault only for handled actions.
export function reviewShortcut(event, root, search, hasQuery) {
  const target=event.target;
  if(!root?.contains(target)||event.defaultPrevented||event.isComposing)return null;
  if(target?.closest?.('.monaco-editor')||target?.closest?.('.vcs-history'))return null;
  if(event.key==='Escape'&&target===search&&hasQuery)return 'clear';
  const editing=target?.isContentEditable||target?.closest?.('input,textarea,select,[role="textbox"]');
  if(editing&&target!==search)return null;
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.key?.toLowerCase()==='f')return 'search';
  if(!editing&&event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey){
    if(event.key==='ArrowLeft')return 'previous';
    if(event.key==='ArrowRight')return 'next';
  }
  return null;
}
