import {parseSvnRevision,previousSvnRevision} from './svn-revision.mjs';
import {scopeSvnChanges} from './svn-changes.mjs';
// Planning only: callers must revalidate membership and authorization before any I/O.
export function planSvnComparison(records,{scope,revision,path}={}){
 if(parseSvnRevision(revision)===0n)throw new Error('SVN r0 has no change comparison');
 const member=scopeSvnChanges(records,{scope,revision}).find(entry=>entry.path===path);
 if(!member)throw new Error('SVN path is not an authorized changed member');
 if(member.kind!=='file')throw new Error('Only SVN file changes can be compared');
 const before=previousSvnRevision(revision);
 const side=value=>value===null?{empty:true}:{empty:false,path:member.path,revision:value,pegRevision:value};
 return {path:member.path,action:member.action,left:side(member.action==='A'?null:before),right:side(member.action==='D'?null:revision)};
}
