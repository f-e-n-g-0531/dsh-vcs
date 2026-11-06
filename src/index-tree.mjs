import {encodeGitTree} from './git-commit-object.mjs';

// Pure flat-index -> tree-object assembly: no I/O, object lookup or ref updates.
// Only canonical regular-file modes are accepted; OIDs are lowercase, nonzero,
// full-width hex. Referenced blobs need not exist (and are never inspected).
// Paths must be strict UTF-8 strings, relative, slash-separated and <=4096 bytes.
// Empty/dot/dotdot/.git components, backslashes, colons and Unicode controls,
// format characters and line/paragraph separators are rejected.
// Conservative portable-name policy: sibling names must be distinct under
// NFC -> Unicode uppercase -> lowercase -> NFC. This deliberately rejects some
// Git-legal case/normalization aliases (including SS/ß); it is not an assertion
// of complete filesystem-specific Unicode case folding. Original bytes survive.
// Limits: 100000 entries; 64 path components (including the filename);
// 100001 trie nodes INCLUDING root, files and directories; 8 MiB aggregate tree
// bodies (not object headers). Root path is ''. Trees are deterministic raw-UTF8
// sibling-sorted postorder (children before parents), with root last, including
// one canonical empty root for empty input. Each output body owns its memory.
const MAX_ENTRIES=100000,MAX_PATH_BYTES=4096,MAX_DEPTH=64;
const MAX_NODES=100001,MAX_TREE_BYTES=8*1024*1024;
const fold=name=>name.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');

export function buildIndexTree(entries,{objectFormat='sha1'}={}){
 if(objectFormat!=='sha1'&&objectFormat!=='sha256')throw Error('Unsupported Git object format');
 if(!Array.isArray(entries))throw Error('Git index entries must be an array');
 if(entries.length>MAX_ENTRIES)throw Error('Git index entry limit exceeded');
 const oidLength=objectFormat==='sha1'?40:64;
 const root={path:'',children:new Map(),folded:new Map()};
 let nodes=1,totalBytes=0;
 for(const entry of entries){
  if(!entry||typeof entry!=='object')throw Error('Invalid Git index entry');
  const {path,mode,oid}=entry;
  if(typeof path!=='string')throw Error('Git index path must be a string');
  if(path.length>MAX_PATH_BYTES)throw Error('Git index path byte limit exceeded');
  const bytes=Buffer.from(path,'utf8');
  if(bytes.toString('utf8')!==path)throw Error('Git index path must be strict UTF-8');
  if(bytes.length>MAX_PATH_BYTES)throw Error('Git index path byte limit exceeded');
  if(!path||/[\\:\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(path))throw Error('Unsafe Git index path');
  const parts=path.split('/');
  if(parts.length>MAX_DEPTH)throw Error('Git index path depth limit exceeded');
  if(parts.some(part=>!part||part==='.'||part==='..'||fold(part)==='.git'))throw Error('Unsafe Git index path component');
  if(mode!=='100644'&&mode!=='100755')throw Error('Unsupported Git index file mode');
  if(typeof oid!=='string'||oid.length!==oidLength||/[^0-9a-f]/.test(oid)||/^0+$/.test(oid))throw Error('Invalid Git index object id');
  let parent=root;
  for(let i=0;i<parts.length;i++){
   const name=parts[i],last=i===parts.length-1,key=fold(name);
   const alias=parent.folded.get(key);
   if(alias!==undefined&&alias!==name)throw Error('Git index casefold/normalization collision');
   const existing=parent.children.get(name);
   if(existing){
    if(last){
     if(existing.children)throw Error('Git index file-directory prefix collision');
     throw Error('Duplicate Git index path');
    }
    if(!existing.children)throw Error('Git index file-directory prefix collision');
    parent=existing;
    continue;
   }
   if(++nodes>MAX_NODES)throw Error('Git index node limit exceeded');
   const nodeMode=last?mode:'40000';
   totalBytes+=nodeMode.length+2+Buffer.byteLength(name,'utf8')+oidLength/2;
   if(totalBytes>MAX_TREE_BYTES)throw Error('Git index aggregate tree byte limit exceeded');
   const node=last?{mode,oid}:{path:parts.slice(0,i+1).join('/'),children:new Map(),folded:new Map()};
   parent.children.set(name,node);parent.folded.set(key,name);
   parent=node;
  }
 }
 const trees=[];
 function encode(directory){
  const children=[...directory.children].sort((a,b)=>Buffer.compare(Buffer.from(a[0]),Buffer.from(b[0])));
  const encodedEntries=children.map(([name,node])=>({name,mode:node.children?'40000':node.mode,oid:node.children?encode(node):node.oid}));
  const encoded=encodeGitTree(encodedEntries,{objectFormat});
  const body=Buffer.alloc(encoded.body.length);encoded.body.copy(body);
  trees.push({path:directory.path,oid:encoded.oid,body});
  return encoded.oid;
 }
 return {root:encode(root),trees};
}
