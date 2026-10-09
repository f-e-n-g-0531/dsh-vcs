import {svnHistoryTarget} from './svn-target.mjs';
// A link is not authorization. Caller still needs verified UUID and baseline semantics.
export function validateSvnDavLink(href,{root}={}){
 svnHistoryTarget(root,'/','0');if(typeof href!=='string'||!href||href.length>32768||/[\\?#]/.test(href)||[...href].some(c=>c.charCodeAt(0)<=32||c.charCodeAt(0)===127))throw Error('Invalid DAV href');
 if(!(href.startsWith('/')&&!href.startsWith('//'))&&!href.startsWith('https://'))throw Error('DAV href must be absolute path or HTTPS URL');
 const url=new URL(href,new URL(root).origin);if(url.protocol!=='https:'||url.origin!==new URL(root).origin||url.username||url.password||url.search||url.hash)throw Error('DAV href outside authorized origin');if(href.startsWith('https://')&&url.href!==href||href.startsWith('/')&&url.pathname!==href)throw Error('Noncanonical DAV href');
 const parts=url.pathname.split('/').slice(1);if(parts.at(-1)==='')parts.pop();for(const part of parts){const decoded=decodeURIComponent(part);if(!part||decoded==='.'||decoded==='..'||[...decoded].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127||c==='/'||c.charCodeAt(0)===92))throw Error('Unsafe DAV href path');}
 const base=new URL(root).pathname.replace(/[/]$/,'');if(base&&url.pathname!==base&&!url.pathname.startsWith(base+'/'))throw Error('DAV href outside repository root');return url.href;
}
