import {validateSvnPath,svnPathInScope} from './svn-path.mjs';
import {parseSvnRevision} from './svn-revision.mjs';
// Normalized records only; XML parsing and network authorization remain separate.
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
