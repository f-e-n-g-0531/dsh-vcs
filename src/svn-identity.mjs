import {XMLParser,XMLValidator} from 'fast-xml-parser';import {svnHistoryTarget} from './svn-target.mjs';import {validateSvnPath} from './svn-path.mjs';import {parseSvnRevision} from './svn-revision.mjs';
// Only local working-copy info XML. Never follows URLs or contacts a server.
export function parseSvnIdentity(xml){
 if(typeof xml!=='string'||Buffer.byteLength(xml)>2097152||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw Error('Invalid local SVN info XML');
 const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false,isArray:name=>name==='entry'}).parse(xml),entries=parsed?.info?.entry;
 if(!Array.isArray(entries)||entries.length!==1)throw Error('SVN info requires one working copy root');const e=entries[0],root=e.repository?.root,uuid=e.repository?.uuid,relative=e['relative-url'],url=e.url,wcRoot=e['wc-info']?.['wcroot-abspath'];
 if(e['@_kind']!=='dir'||typeof wcRoot!=='string'||!wcRoot||wcRoot.includes('\0'))throw Error('SVN identity requires working copy directory');
 svnHistoryTarget(root,'/','0');if(typeof uuid!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(uuid))throw Error('Invalid local SVN UUID');
 if(typeof relative!=='string'||!relative.startsWith('^/'))throw Error('Invalid local SVN relative URL');const encoded=relative.slice(1);const scope=encoded==='/'?'/':encoded.split('/').map((part,i)=>{if(i===0)return '';const value=decodeURIComponent(part);if(value.includes('/')||value.includes('\\'))throw Error('Encoded SVN path separator');return value;}).join('/');validateSvnPath(scope);
 const expected=svnHistoryTarget(root,scope,'0').slice(0,-2);if(url!==expected)throw Error('SVN local URL and scope mismatch');const revision=e['@_revision'];parseSvnRevision(revision);
 return {root,uuid,scope,origin:new URL(root).origin,wcRoot,revision};
}
