import {validateSvnPath} from './svn-path.mjs';
import {parseSvnRevision} from './svn-revision.mjs';
// Pure construction only. Origin, UUID, scope, redirects and consent require separate checks.
export function svnHistoryTarget(root,path,revision){
 validateSvnPath(path);parseSvnRevision(revision);
 if(typeof root!=='string'||root.length>32768||/[\x00-\x20\x7f\\?#]/.test(root))throw new Error('Invalid SVN HTTPS root');
 const url=new URL(root);
 if(url.protocol!=='https:'||url.username||url.password||url.href!==root)throw new Error('Noncanonical SVN HTTPS root');
 const parts=url.pathname.split('/').slice(1);if(parts.at(-1)==='')parts.pop();
 for(const part of parts){const decoded=decodeURIComponent(part);if(!part||decoded==='.'||decoded==='..'||/[\x00-\x1f\x7f/\\]/.test(decoded))throw new Error('Invalid SVN root path');}
 const base=root.endsWith('/')?root.slice(0,-1):root;
 const encoded=path==='/'?'':path.split('/').map(part=>encodeURIComponent(part).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())).join('/');
 const target=base+(encoded||(url.pathname==='/'?'/':''))+'@'+revision;
 if(target.length>32768)throw new Error('SVN target too long');
 return target;
}
