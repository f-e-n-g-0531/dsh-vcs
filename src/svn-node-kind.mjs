import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {parseDavXml} from './svn-dav-xml.mjs';
import {validateSvnDavLink} from './svn-dav-link.mjs';

// A kind is useful only when bound to the exact authorized historical node.
export function parseSvnNodeKind(xml,{target,revision,root,uuid}={}){
 if(typeof xml!=='string'||Buffer.byteLength(xml)>2097152||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('Invalid SVN node kind XML');
 const doc=new XMLParser({ignoreAttributes:false,parseAttributeValue:false,parseTagValue:false,trimValues:false,isArray:name=>name==='entry'}).parse(xml);
 const entries=doc?.info?.entry;
 if(!Array.isArray(entries)||entries.length!==1)throw Error('Expected one SVN node kind entry');
 const node=entries[0];
 if(node.url!==target||node['@_revision']!==revision||node.repository?.root!==root||node.repository?.uuid!==uuid)throw Error('SVN node kind identity mismatch');
 if(!['file','dir'].includes(node['@_kind']))throw Error('Unknown SVN node kind');
 return node['@_kind'];
}

export function parseSvnDavNodeKind(xml,{root,target}={}){
 const doc=parseDavXml(xml),check=(node,keys)=>{if(!node||typeof node!=='object'||Array.isArray(node)||Object.keys(node).some(key=>!keys.includes(key)))throw Error('Invalid DAV node kind structure');};
 check(doc,['D:multistatus']);check(doc['D:multistatus'],['D:response']);
 const responses=doc['D:multistatus']['D:response'];
 if(responses?.length!==1)throw Error('Expected one DAV node kind response');
 const response=responses[0];check(response,['D:href','D:propstat']);
 const href=validateSvnDavLink(response['D:href'],{root});
 if(response['D:propstat']?.length!==1)throw Error('Expected one DAV node kind status');
 const status=response['D:propstat'][0];check(status,['D:status','D:prop']);
 if(!/^HTTP[/]1[.][01] 200(?: OK)?$/.test(status['D:status']))throw Error('DAV node kind unavailable');
 check(status['D:prop'],['D:resourcetype']);const type=status['D:prop']['D:resourcetype'];
 if(type===''){if(href!==target)throw Error('DAV node kind target mismatch');return 'file';}
 check(type,['D:collection']);if(type['D:collection']!=='')throw Error('Unknown DAV node kind');
 if(href!==target&&href!==target+'/')throw Error('DAV node kind target mismatch');
 return 'dir';
}
