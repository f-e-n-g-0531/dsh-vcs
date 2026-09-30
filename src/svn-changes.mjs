import {validateSvnPath,svnPathInScope} from './svn-path.mjs';
import {parseSvnRevision} from './svn-revision.mjs';
// Parsed XML path nodes only; document validation and network authorization remain separate.
export function scopeSvnPathNodes(nodes,options){
 if(!Array.isArray(nodes)||nodes.length>10000)throw new Error('Invalid SVN path nodes');
 const records=nodes.map(node=>{
  const keys=['#text','@_action','@_kind','@_copyfrom-path','@_copyfrom-rev','@_text-mods','@_prop-mods'];
  if(!node||typeof node!=='object'||Array.isArray(node)||Object.keys(node).some(k=>!keys.includes(k)))throw new Error('Invalid SVN path node');
  // Modification flags are validated, but this initial membership view does not expose them.
  for(const key of ['@_text-mods','@_prop-mods'])if(Object.hasOwn(node,key)&&!['true','false','unknown'].includes(node[key]))throw new Error('Invalid SVN modification flag');
  return {path:node['#text'],action:node['@_action'],kind:node['@_kind'],...(Object.hasOwn(node,'@_copyfrom-path')?{copyFromPath:node['@_copyfrom-path']}:{}),...(Object.hasOwn(node,'@_copyfrom-rev')?{copyFromRevision:node['@_copyfrom-rev']}:{})};
 });
 return scopeSvnChanges(records,options);
}
export function scopeSvnChanges(records,{scope,revision}={}){
 validateSvnPath(scope);const current=parseSvnRevision(revision);
 if(!Array.isArray(records)||records.length>10000)throw new Error('Invalid SVN changed paths');
 const seen=new Set();const checked=records.map(record=>{
  if(!record||typeof record!=='object'||Array.isArray(record)||Object.keys(record).some(k=>!['path','action','kind','copyFromPath','copyFromRevision'].includes(k)))throw new Error('Invalid SVN change structure');
  const {path,action,kind,copyFromPath,copyFromRevision}=record;validateSvnPath(path);
  if(seen.has(path)||!['A','D','M','R'].includes(action)||!['file','dir','unknown'].includes(kind))throw new Error('Invalid SVN change');seen.add(path);
  const copied=copyFromPath!==undefined||copyFromRevision!==undefined;
  if(copied){validateSvnPath(copyFromPath);if(!['A','R'].includes(action)||parseSvnRevision(copyFromRevision)>=current)throw new Error('Invalid SVN copy source');}
  const result={path,action,kind};
  if(copied){if(svnPathInScope(copyFromPath,scope)){result.copyFromPath=copyFromPath;result.copyFromRevision=copyFromRevision;}else result.copySourceOutsideScope=true;}
  return result;
 });
 return checked.filter(record=>svnPathInScope(record.path,scope));
}
