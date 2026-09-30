// Pure preparatory helpers; no SVN command or network access.
const MAX_REVISION=9223372036854775807n;
export function parseSvnRevision(value){
 if(typeof value!=='string'||value.length>19||!/^(0|[1-9][0-9]*)$/.test(value))throw new Error('Invalid SVN revision');
 const number=BigInt(value);if(number>MAX_REVISION)throw new Error('SVN revision exceeds supported range');return number;
}
export function previousSvnRevision(value){const revision=parseSvnRevision(value);return revision===0n?null:String(revision-1n);}
export function svnRevisionPage(revisions,{snapshot,cursor=snapshot,limit=50}={}){
 const upper=parseSvnRevision(snapshot),start=parseSvnRevision(cursor);
 if(start>upper||!Number.isInteger(limit)||limit<1||limit>100||!Array.isArray(revisions)||revisions.length>limit+1)throw new Error('Invalid SVN page bounds');
 let previous=start+1n;
 for(const value of revisions){const revision=parseSvnRevision(value);if(revision>start||revision>=previous)throw new Error('SVN revisions must descend within cursor');previous=revision;}
 const visible=revisions.slice(0,limit);
 return {snapshot,revisions:visible,nextRevision:revisions.length>limit?previousSvnRevision(visible.at(-1)):null};
}
