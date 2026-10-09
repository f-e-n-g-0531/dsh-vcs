import {randomBytes} from 'node:crypto';import {svnHistoryTarget} from './svn-target.mjs';import {validateSvnPath} from './svn-path.mjs';
function identity(value){
 if(!value||typeof value!=='object')throw Error('Invalid SVN consent identity');const {sessionId,cwd,repositoryId,root,uuid,scope}=value;
 for(const text of [sessionId,cwd,repositoryId])if(typeof text!=='string'||!text||text.length>32768||text.includes('\0'))throw Error('Invalid SVN consent scope');
 svnHistoryTarget(root,'/','0');validateSvnPath(scope);if(typeof uuid!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid))throw Error('Invalid SVN repository UUID');
 return JSON.stringify([sessionId,cwd,repositoryId,root,uuid,scope]);
}
// Server-only capabilities. This does not authorize redirects or execute transport.
export function createSvnConsent({now=Date.now,ttlMs=300000,maxEntries=32,onRevoke=()=>{}}={}){
 if(!Number.isInteger(ttlMs)||ttlMs<1||ttlMs>300000||!Number.isInteger(maxEntries)||maxEntries<1||maxEntries>32)throw Error('Invalid SVN consent bounds');if(typeof onRevoke!=='function')throw Error('Invalid SVN revoke listener');const grants=new Map();const remove=token=>{if(grants.delete(token))onRevoke(token);};
 const prune=()=>{for(const [token,g] of grants)if(g.expires<=now())remove(token);};
 return {
 grant(value,{explicit=false}={}){if(explicit!==true)throw Error('Explicit SVN network consent required');const key=identity(value);prune();for(const [token,g] of grants)if(g.key===key)remove(token);while(grants.size>=maxEntries)remove(grants.keys().next().value);const token=randomBytes(32).toString('hex');grants.set(token,{key,sessionId:value.sessionId,expires:now()+ttlMs});return token;},
 assert(token,value){prune();const key=identity(value),grant=grants.get(token);if(!grant||grant.key!==key)throw Error('SVN network consent missing, expired or identity changed');},
 revokeSession(sessionId){for(const [token,g] of grants)if(g.sessionId===sessionId)remove(token);},
 revoke(token){remove(token);}
 };
}
