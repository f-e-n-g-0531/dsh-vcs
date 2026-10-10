import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {confined} from './repository-path.mjs';
import {MAX_LARGE_TEXT,decodeLargeText} from './text-content.mjs';
const fingerprint=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');

/** Read complete bounded text, retaining a final named-path verification. No writes. */
export async function readWorkspaceLargeText(root,file,signal){
 const check=()=>signal?.throwIfAborted();
 const resolve=async()=>{
  check();const target=await confined(root,file);let component=root;
  for(const part of path.relative(root,target).split(path.sep).filter(Boolean)){
   component=path.join(component,part);const info=await fs.lstat(component);
   if(info.isSymbolicLink())throw Error('Large workspace comparison does not support links');
  }
  return target;
 };
 const target=await resolve(),before=await fs.lstat(target,{bigint:true});
 if(!before.isFile())throw Error('Large workspace comparison requires a regular file');
 if(before.size>BigInt(MAX_LARGE_TEXT))throw Error('Large comparison exceeds 8 MiB per side');
 const verify=async()=>{await resolve();const named=await fs.lstat(target,{bigint:true});if(!named.isFile()||named.isSymbolicLink()||fingerprint(named)!==fingerprint(before))throw Error('Working file changed; refresh repository status');check();};
 const handle=await fs.open(target,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{
  const opened=await handle.stat({bigint:true});if(!opened.isFile()||fingerprint(opened)!==fingerprint(before))throw Error('Working file changed during open');
  const buffer=Buffer.alloc(Number(before.size)+1);let offset=0;
  while(offset<buffer.length){check();const result=await handle.read(buffer,offset,buffer.length-offset,offset);if(!result.bytesRead)break;offset+=result.bytesRead;}
  check();if(offset!==Number(before.size)||fingerprint(await handle.stat({bigint:true}))!==fingerprint(before))throw Error('Working file changed during read');
  await verify();const value=decodeLargeText(buffer.subarray(0,offset),signal);await verify();
  return {value,verify};
 }finally{await handle.close();}
}
