import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {parseSvnRevision} from './svn-revision.mjs';
// Offline preparation only: this module does not authorize or perform requests.
export function parseSvnLog(xml){
 if(typeof xml!=='string'||Buffer.byteLength(xml,'utf8')>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('Invalid SVN log XML');
 const parser=new XMLParser({ignoreAttributes:false,parseAttributeValue:false,parseTagValue:false,trimValues:false,isArray:name=>name==='logentry'});
 const document=parser.parse(xml);
 if(!Object.hasOwn(document,'log')||Object.keys(document).some(k=>k!=='log'&&k!=='?xml'))throw new Error('Invalid SVN log root');
 const log=document.log;if(typeof log==='string'&&log.trim()==='')return [];
 if(log&&typeof log==='object'&&typeof log['#text']==='string'&&log['#text'].trim()==='')delete log['#text'];
 if(!log||typeof log!=='object'||Object.keys(log).some(k=>k!=='logentry')||!Array.isArray(log.logentry)||log.logentry.length>101)throw new Error('Invalid SVN log entries');
 const seen=new Set();return log.logentry.map(entry=>{
  const revision=entry['@_revision'];parseSvnRevision(revision);if(seen.has(revision))throw new Error('Duplicate SVN revision');seen.add(revision);
  const text=key=>{const value=entry[key]??'';if(typeof value!=='string')throw new Error('Invalid SVN log text');return value;};
  return {revision,author:text('author'),date:text('date'),message:text('msg')};
 });
}
