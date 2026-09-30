import {XMLParser,XMLValidator} from 'fast-xml-parser';
// Names-only proplist output. Target binding is not a substitute for a revision-bound request.
export function parseSvnPropertyNames(xml,{target}={}){
 if(typeof target!=='string'||!target||target.length>32768)throw new Error('Invalid SVN property target');
 if(typeof xml!=='string'||Buffer.byteLength(xml,'utf8')>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('Invalid SVN property XML');
 const doc=new XMLParser({ignoreAttributes:false,parseAttributeValue:false,parseTagValue:false,trimValues:false,isArray:name=>name==='target'||name==='property'}).parse(xml);
 const check=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)&&!(k==='#text'&&typeof value[k]==='string'&&value[k].trim()==='')))throw new Error('Invalid SVN property structure');};
 check(doc,['?xml','properties']);check(doc.properties,['target']);
 const targets=doc.properties.target;
 if(!Array.isArray(targets)||targets.length!==1)throw new Error('Expected one SVN property target');
 const node=targets[0];check(node,['@_path','property']);
 if(node['@_path']!==target)throw new Error('SVN property target mismatch');
 const properties=node.property??[];
 if(!Array.isArray(properties)||properties.length>10000)throw new Error('Too many SVN properties');
 const names=[],seen=new Set();
 for(const property of properties){
  check(property,['@_name']);const name=property['@_name'];
  if(typeof name!=='string'||!name||name.length>1024||/[\x00-\x20\x7f]/.test(name)||seen.has(name))throw new Error('Invalid SVN property name');
  seen.add(name);names.push(name);
 }
 return {target,names,special:seen.has('svn:special')};
}
