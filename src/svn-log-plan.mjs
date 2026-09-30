import {svnRevisionPage,parseSvnRevision} from './svn-revision.mjs';
import {svnPathInScope} from './svn-path.mjs';
import {svnHistoryTarget} from './svn-target.mjs';
export function planSvnDetail({root,scope,path=scope,snapshot,revision}={}){
 if(parseSvnRevision(revision)>parseSvnRevision(snapshot))throw new Error('SVN selected revision exceeds snapshot');
 if(!svnPathInScope(path,scope))throw new Error('SVN detail path outside scope');
 const target=svnHistoryTarget(root,path,snapshot);
 return {scope,revision,snapshot,args:['log','--xml','--verbose','--stop-on-copy','--non-interactive','--no-auth-cache','--limit','1','-r',revision+':'+revision,'--',target]};
}
// Not executable authorization. Runtime must bind consent, server identity and bounded I/O separately.
export function planSvnLog({root,scope,path=scope,snapshot,cursor=snapshot,limit=50}={}){
 svnRevisionPage([],{snapshot,cursor,limit});
 if(!svnPathInScope(path,scope))throw new Error('SVN history path outside scope');
 const target=svnHistoryTarget(root,path,snapshot);
 return {snapshot,cursor,limit,args:['log','--xml','--stop-on-copy','--non-interactive','--no-auth-cache','--limit',String(limit+1),'-r',cursor+':0','--',target]};
}
