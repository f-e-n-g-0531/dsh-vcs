import {createHash,timingSafeEqual} from 'node:crypto';
import {TextDecoder} from 'node:util';

// Pure Buffer transformations only: no repository, filesystem or subprocess access.
const MAX_BYTES=8*1024*1024,MAX_ENTRIES=100000;
const DERIVED_EXTENSIONS=new Set(['TREE','EOIE','IEOT']);
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function formatInfo(objectFormat){
 if(objectFormat!=='sha1'&&objectFormat!=='sha256')throw Error('Unsupported Git index object format');
 return {objectFormat,hashBytes:objectFormat==='sha1'?20:32};
}
function validPath(path){
 if(typeof path!=='string'||!path||/[\u0000-\u001f\u007f\\:<>"|?*]/u.test(path))throw Error('Unsafe Git index path');
 for(const part of path.split('/')){
  if(!part||part==='.'||part==='..'||part.toLowerCase()==='.git'||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))throw Error('Unsafe Git index path');
 }
 return path;
}
function validMode(mode){
 if(mode!=='100644'&&mode!=='100755')throw Error('Unsupported Git index mode');
 return mode;
}
function validOid(oid,hashBytes){
 if(typeof oid!=='string'||oid.length!==hashBytes*2||!/^[0-9a-f]+$/.test(oid)||/^0+$/.test(oid))throw Error('Invalid Git index object id');
 return oid;
}
function inspect(buffer,objectFormat){
 const {hashBytes}=formatInfo(objectFormat);
 if(!Buffer.isBuffer(buffer))throw Error('Git index must be a Buffer');
 if(buffer.length>MAX_BYTES)throw Error('Git index byte limit exceeded');
 if(buffer.length<12+hashBytes)throw Error('Truncated Git index header');
 const end=buffer.length-hashBytes;
 if(buffer.subarray(end).every(byte=>byte===0))throw Error('Unsupported unverifiable Git index skipHash checksum');
 if(!timingSafeEqual(createHash(objectFormat).update(buffer.subarray(0,end)).digest(),buffer.subarray(end)))throw Error('Git index checksum mismatch');
 if(buffer.toString('ascii',0,4)!=='DIRC'||!buffer.subarray(0,4).equals(Buffer.from('DIRC')))throw Error('Invalid Git index signature');
 const version=buffer.readUInt32BE(4),count=buffer.readUInt32BE(8),fixed=42+hashBytes;
 if(version!==2&&version!==3)throw Error('Unsupported Git index version');
 if(count>MAX_ENTRIES)throw Error('Git index entry limit exceeded');
 if(count>Math.floor((end-12)/(Math.ceil((fixed+2)/8)*8)))throw Error('Truncated Git index entries');
 const entries=[],locations=[],extensions=[],extensionNames=new Set();
 let offset=12,previous=null;
 for(let i=0;i<count;i++){
  const start=offset;
  if(fixed>end-offset)throw Error('Truncated Git index entry');
  const flags=buffer.readUInt16BE(start+40+hashBytes);
  if(flags&0xc000)throw Error('Unsupported Git index assume-valid or extended flags');
  if(flags&0x3000)throw Error('Git index must contain stage 0 entries only');
  const mode=validMode(buffer.readUInt32BE(start+24).toString(8));
  const oid=validOid(buffer.toString('hex',start+40,start+40+hashBytes),hashBytes);
  const pathStart=start+fixed,nul=buffer.indexOf(0,pathStart);
  if(nul<0||nul>=end)throw Error('Missing Git index path NUL');
  const bytes=buffer.subarray(pathStart,nul);
  if((flags&0xfff)!==Math.min(bytes.length,0xfff))throw Error('Git index path length mismatch');
  let path;
  try{path=utf8.decode(bytes);}catch{throw Error('Invalid Git index UTF-8 path');}
  validPath(path);
  if(previous&&Buffer.compare(previous,bytes)>=0)throw Error('Git index paths must be unique and byte ordered');
  previous=bytes;
  offset=start+Math.ceil((nul+1-start)/8)*8;
  if(offset>end)throw Error('Truncated Git index padding');
  for(let p=nul;p<offset;p++)if(buffer[p]!==0)throw Error('Nonzero Git index path padding');
  entries.push({path,oid,mode,flags});locations.push({start,end:offset});
 }
 const entriesEnd=offset;
 while(offset<end){
  if(end-offset<8)throw Error('Truncated Git index extension header');
  const signature=buffer.toString('latin1',offset,offset+4),size=buffer.readUInt32BE(offset+4);
  if(!/^[A-Za-z][A-Za-z0-9 ]{3}$/.test(signature))throw Error('Invalid Git index extension signature');
  if(!/^[A-Z]/.test(signature))throw Error('Unsupported mandatory Git index extension: '+signature);
  if(size>end-offset-8)throw Error('Truncated Git index extension payload');
  if(extensionNames.has(signature))throw Error('Duplicate Git index extension');
  extensionNames.add(signature);
  extensions.push({signature,size,offset});offset+=8+size;
 }
 return {version,entries,extensions,locations,entriesEnd,hashBytes};
}

// Modes are canonical octal strings; paths retain their exact UTF-8 spelling and case.
// Optional extension payloads are opaque: only their bounded framing is parsed.
export function parseGitIndex(buffer,{objectFormat='sha1'}={}){
 const {version,entries,extensions}=inspect(buffer,objectFormat);
 return {version,entries,extensions};
}

// Returns an unpublished candidate Buffer. Never adds/removes paths or changes offsets.
export function replaceGitIndexEntry(buffer,{path,expectedOid,expectedMode,oid,mode,objectFormat='sha1'}){
 const source=inspect(buffer,objectFormat);
 validPath(path);validMode(expectedMode);validMode(mode);
 validOid(expectedOid,source.hashBytes);validOid(oid,source.hashBytes);
 if(source.extensions.some(extension=>!DERIVED_EXTENSIONS.has(extension.signature)))throw Error('Unsupported semantic Git index extension for replacement');
 const selected=source.entries.findIndex(entry=>entry.path===path);
 if(selected<0)throw Error('Selected Git index path does not exist');
 const entry=source.entries[selected];
 if(entry.oid!==expectedOid||entry.mode!==expectedMode)throw Error('Git index expected tuple mismatch');
 const body=Buffer.from(buffer.subarray(0,source.entriesEnd)),start=source.locations[selected].start;
 // Publication advances index mtime: clear every stat cache, including untouched
 // racily-clean entries, without changing their mode/OID/path/flags semantics.
 for(const location of source.locations){
  body.fill(0,location.start,location.start+24);
  body.fill(0,location.start+28,location.start+40);
 }
 body.writeUInt32BE(parseInt(mode,8),start+24);
 Buffer.from(oid,'hex').copy(body,start+40);
 const candidate=Buffer.concat([body,createHash(objectFormat).update(body).digest()]);
 const verified=inspect(candidate,objectFormat);
 if(verified.version!==source.version||verified.entries.length!==source.entries.length||verified.extensions.length)throw Error('Git index candidate structure mismatch');
 for(let i=0;i<source.entries.length;i++){
  const before=source.entries[i],after=verified.entries[i],location=source.locations[i];
  if(after.path!==before.path||after.flags!==before.flags||after.oid!==(i===selected?oid:before.oid)||after.mode!==(i===selected?mode:before.mode)||verified.locations[i].start!==location.start||verified.locations[i].end!==location.end)throw Error('Git index candidate semantic mismatch');
  if(!candidate.subarray(location.start+40,location.end).equals(i===selected?Buffer.concat([Buffer.from(oid,'hex'),buffer.subarray(location.start+40+source.hashBytes,location.end)]):buffer.subarray(location.start+40,location.end)))throw Error('Git index candidate changed path or flags');
 }
 return candidate;
}
