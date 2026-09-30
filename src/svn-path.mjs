// SVN repository fspaths, not URLs or local filesystem paths. Never decode here.
export function validateSvnPath(value){
 if(typeof value!=='string'||value.length>32768||!value.startsWith('/')||/[\u0000-\u001f\u007f\\]/.test(value))throw new Error('Invalid SVN repository path');
 if(value!=='/'&&value.slice(1).split('/').some(part=>part===''||part==='.'||part==='..'))throw new Error('Noncanonical SVN repository path');
 return value;
}
export function svnPathInScope(value,scope){
 validateSvnPath(value);validateSvnPath(scope);
 return scope==='/'||value===scope||value.startsWith(scope+'/');
}
export function relativeSvnPath(value,scope){
 if(!svnPathInScope(value,scope))throw new Error('SVN path outside authorized scope');
 if(value===scope)return '';return value.slice(scope==='/'?1:scope.length+1);
}
