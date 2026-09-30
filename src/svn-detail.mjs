import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {parseSvnRevision} from './svn-revision.mjs';
import {scopeSvnPathNodes} from './svn-changes.mjs';
export function parseSvnDetail(xml,{scope,revision}={}){
 parseSvnRevision(revision);
 if(typeof xml!=='string'||Buffer.byteLength(xml,'utf8')>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('Invalid SVN detail XML');
 const doc=new XMLParser({ignoreAttributes:false,parseAttributeValue:false,parseTagValue:false,trimValues:false,isArray:name=>name==='logentry'||name==='path'}).parse(xml);
 const check=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)&&!(k==='#text'&&typeof value[k]==='string'&&/^[ \t\r\n]*$/.test(value[k]))))throw new Error('Invalid SVN detail structure');};
 check(doc,['?xml','log']);check(doc.log,['logentry']);
 if(!Array.isArray(doc.log.logentry)||doc.log.logentry.length!==1)throw new Error('Expected one SVN revision');
 const entry=doc.log.logentry[0];check(entry,['@_revision','author','date','msg','paths']);
 if(entry['@_revision']!==revision)throw new Error('SVN detail revision mismatch');
 const text=key=>{const value=entry[key]??'';if(typeof value!=='string')throw new Error('Invalid SVN detail text');return value;};
 let nodes=[];
 if(entry.paths!==undefined&&!(typeof entry.paths==='string'&&/^[ \t\r\n]*$/.test(entry.paths))){check(entry.paths,['path']);nodes=entry.paths.path??[];}
 const changes=scopeSvnPathNodes(nodes,{scope,revision});
 return {revision,author:text('author'),date:text('date'),message:text('msg'),pathsAvailable:Object.hasOwn(entry,'paths'),changes};
}
