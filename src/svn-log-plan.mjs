import {svnRevisionPage} from './svn-revision.mjs';
import {svnPathInScope} from './svn-path.mjs';
import {svnHistoryTarget} from './svn-target.mjs';
// Not executable authorization. Runtime must bind consent, server identity and bounded I/O separately.
export function planSvnLog({root,scope,path=scope,snapshot,cursor=snapshot,limit=50}={}){
 svnRevisionPage([],{snapshot,cursor,limit});
 if(!svnPathInScope(path,scope))throw new Error('SVN history path outside scope');
 const target=svnHistoryTarget(root,path,snapshot);
 return {snapshot,cursor,limit,args:['log','--xml','--stop-on-copy','--non-interactive','--no-auth-cache','--limit',String(limit+1),'-r',cursor+':0','--',target]};
}
