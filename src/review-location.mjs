// Navigation contains presentation coordinates only: never roots, grants or source text.
function viewerOptions(value) { return {sideBySide:value?.sideBySide!==false,ignoreWhitespace:value?.ignoreWhitespace===true,wrap:value?.wrap===true,enabled:value?.enabled!==false}; }
export function reviewLocation(value = {}) {
  const path = typeof value.path === 'string' && value.path.length <= 32768 ? value.path : null;
  return {
    id: typeof value.id === 'string' ? value.id : null,
    path,
    source: ['tree','blame-origin'].includes(value.source) ? value.source : 'comparison',
    tree: {directory: typeof value.tree?.directory === 'string' ? value.tree.directory.slice(0,32768) : '', offset: Number.isInteger(value.tree?.offset) && value.tree.offset >= 0 && value.tree.offset <= 100000 ? value.tree.offset : 0, query: typeof value.tree?.query === 'string' ? value.tree.query.slice(0,1024) : '', path: typeof value.tree?.path === 'string' && value.tree.path.length <= 32768 ? value.tree.path : null, viewer: viewerOptions(value.tree?.viewer)},
    origin: value.origin && typeof value.origin.commit === 'string' && typeof value.origin.path === 'string' ? {commit:value.origin.commit,path:value.origin.path.slice(0,32768),line:Number.isInteger(value.origin.line)&&value.origin.line>0?value.origin.line:null,viewer:viewerOptions(value.origin.viewer)} : null,
    blameStartLine: Number.isInteger(value.blameStartLine) && value.blameStartLine > 0 ? value.blameStartLine : 1,
    parentIndex: Number.isInteger(value.parentIndex) && value.parentIndex >= 0 && value.parentIndex <= 100 ? value.parentIndex : 0,
    line: Number.isInteger(value.line) && value.line > 0 ? value.line : null,
    fileQuery: typeof value.fileQuery === 'string' ? value.fileQuery.slice(0, 1024) : '',
    focused: value.focused === true,
    viewer: viewerOptions(value.viewer),
  };
}
export function pushReviewLocation(stack, location) {
  return [...stack, reviewLocation(location)].slice(-100);
}
export function patchReviewLocation(location, patch) {
  return reviewLocation({...location, ...patch, viewer: {...location.viewer, ...patch.viewer}});
}
