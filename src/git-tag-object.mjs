import {createHash} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {encodeGitCommit} from './git-commit-object.mjs';

// Pure unsigned annotated tags targeting commits only. No I/O, ref/object lookup,
// signing or subprocesses. A claimed commit target is not an existence/type proof.
// Inputs/options/tagger are exact own-data plain/null-prototype records. Buffers
// are copied before options or cooperative signal callbacks; no caller getters run.
// Messages require nonblank strict UTF-8 <=64KiB; CR/LF/TAB and BOM are preserved,
// other Cc and the exact PGP signature BEGIN marker anywhere are refused.
// Short tag names follow branch-create's portable 1000/255 UTF-8 byte policy.
// Parser accepts only this canonical encoder's subset, <=128KiB raw body bytes.
// messageBytes is a byte COUNT, not a Buffer; returned records are frozen.
// Signals: native AbortSignal, or an own-data plain record with optional boolean
// aborted and synchronous throwIfAborted function. Callbacks are trusted but cannot
// change already captured body/options. No hostile Proxy isolation is promised.
const MAX_MESSAGE=64*1024,MAX_BODY=128*1024;
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const nativeAbort=AbortSignal.prototype.throwIfAborted;
const nativeAborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted').get;
function record(value,keys,required,label){
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Invalid '+label+' record');
 const out=Object.create(null);
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||!keys.includes(key))throw Error('Unsupported '+label+' field');
  const d=Object.getOwnPropertyDescriptor(value,key);
  if(!d||!Object.hasOwn(d,'value'))throw Error(label+' requires own data properties');
  out[key]=d.value;
 }
 for(const key of required)if(!Object.hasOwn(out,key))throw Error('Missing '+label+' '+key);
 return out;
}
function format(value){
 if(value!=='sha1'&&value!=='sha256')throw Error('Unsupported Git object format');
 return value==='sha1'?40:64;
}
function oidText(value,width){
 if(typeof value!=='string'||value.length!==width||/[^0-9a-f]/.test(value)||/^0+$/.test(value))throw Error('Invalid Git object id');
 return value;
}
function messageBytes(value){
 if(typeof value!=='string'&&!Buffer.isBuffer(value))throw Error('Git tag message must be a string or Buffer');
 if(value.length>MAX_MESSAGE)throw Error('Git tag message byte limit exceeded');
 const bytes=Buffer.from(value);
 if(bytes.length>MAX_MESSAGE)throw Error('Git tag message byte limit exceeded');
 let text;try{text=utf8.decode(bytes);}catch{throw Error('Git tag message must be strict UTF-8');}
 if(typeof value==='string'&&text!==value)throw Error('Git tag message must be strict UTF-8');
 if(!text.trim()||/[\p{Cc}]/u.test(text.replace(/[\r\n\t]/g,'')))throw Error('Unsafe or blank Git tag message');
 if(text.includes('-----BEGIN PGP SIGNATURE-----'))throw Error('Signed Git tag messages are unsupported');
 return {bytes,text};
}
function tagName(name){
 if(typeof name!=='string'||!name||Buffer.from(name,'utf8').toString('utf8')!==name||Buffer.byteLength(name,'utf8')>1000||
  name==='@'||name.toUpperCase()==='HEAD'||name.startsWith('-')||name.startsWith('refs/')||/[\x00-\x20\x7f~^:?*\[\\<>"|\p{Cc}\p{Cf}]/u.test(name)||name.includes('..')||name.includes('@{')||
  name.split('/').some(p=>!p||Buffer.byteLength(p,'utf8')>255||p.startsWith('.')||/[. ]$/.test(p)||p.toLowerCase().endsWith('.lock')||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw Error('Safe portable short tag name required');
 return name;
}
function hash(body,objectFormat){return createHash(objectFormat).update(Buffer.from('tag '+body.length+'\0','ascii')).update(body).digest('hex');}
function capture(input){
 const r=record(input,['object','tag','tagger','message'],['object','tag','tagger','message'],'Git tag input');
 const tagger=record(r.tagger,['name','email','timestamp','timezone'],['name','email','timestamp','timezone'],'Git tagger');
 const message=messageBytes(r.message);
 return {object:r.object,tag:r.tag,tagger,message};
}
function encodeCaptured(r,objectFormat){
 const width=format(objectFormat),object=oidText(r.object,width),tag=tagName(r.tag),t=r.tagger;
 // Reuse the commit encoder's established identity validation on owned data only.
 encodeGitCommit({tree:object,author:t,committer:t,message:r.message.bytes},{objectFormat});
 const identity=t.name+' <'+t.email+'> '+t.timestamp+' '+t.timezone;
 const body=Buffer.concat([Buffer.from('object '+object+'\ntype commit\ntag '+tag+'\ntagger '+identity+'\n\n','utf8'),r.message.bytes]);
 return {body,oid:hash(body,objectFormat)};
}
export function encodeGitTag(input,options={}){
 const r=capture(input),o=record(options,['objectFormat'],[],'Git tag options');
 return encodeCaptured(r,o.objectFormat===undefined?'sha1':o.objectFormat);
}
function abortCheck(signal){
 if(signal===undefined)return ()=>{};
 // Probe brand with the intrinsic, never an overridden method/property.
 let native=false;try{Reflect.apply(nativeAborted,signal,[]);native=true;}catch{}
 if(native)return ()=>Reflect.apply(nativeAbort,signal,[]);
 const s=record(signal,['aborted','throwIfAborted'],[],'Git tag signal');
 if(s.aborted!==undefined&&typeof s.aborted!=='boolean'||s.throwIfAborted!==undefined&&typeof s.throwIfAborted!=='function')throw Error('Invalid Git tag signal');
 return ()=>{if(s.aborted){const e=Error('Git tag verification aborted');e.name='AbortError';throw e;}if(s.throwIfAborted)Reflect.apply(s.throwIfAborted,signal,[]);};
}
export function parseVerifiedGitTag(bytes,options={}){
 if(!Buffer.isBuffer(bytes))throw Error('Git tag body must be a Buffer');
 if(bytes.length>MAX_BODY)throw Error('Git tag body byte limit exceeded');
 const body=Buffer.from(bytes);
 const o=record(options,['oid','objectFormat','signal'],['oid'],'Git tag verification options');
 const objectFormat=o.objectFormat===undefined?'sha1':o.objectFormat;
 const width=format(objectFormat),oid=oidText(o.oid,width),check=abortCheck(o.signal);
 check();
 if(hash(body,objectFormat)!==oid)throw Error('Git tag object id mismatch');
 check();
 let text;try{text=utf8.decode(body);}catch{throw Error('Git tag body must be strict UTF-8');}
 const end=text.indexOf('\n\n');
 if(end<0)throw Error('Git tag missing header separator');
 const lines=text.slice(0,end).split('\n');
 if(lines.length!==4||!lines[0].startsWith('object ')||lines[1]!=='type commit'||!lines[2].startsWith('tag ')||!lines[3].startsWith('tagger '))throw Error('Unsupported or out-of-order Git tag headers');
 const match=/^([^<>]+) <([^<>]+)> (0|[1-9][0-9]*) ([-+][0-9]{4})$/.exec(lines[3].slice(7));
 if(!match)throw Error('Invalid Git tagger identity');
 const tagger={name:match[1],email:match[2],timestamp:Number(match[3]),timezone:match[4]};
 const input={object:lines[0].slice(7),tag:lines[2].slice(4),tagger,message:text.slice(end+2)};
 check();
 const canonical=encodeGitTag(input,{objectFormat});
 if(canonical.oid!==oid||!canonical.body.equals(body))throw Error('Noncanonical Git tag body');
 check();
 return Object.freeze({oid,object:input.object,tag:input.tag,tagger:Object.freeze(tagger),message:input.message,messageBytes:Buffer.byteLength(input.message,'utf8')});
}
