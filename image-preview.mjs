import {inflate} from 'node:zlib';
import {promisify} from 'node:util';
const inflateAsync=promisify(inflate);
// Structural gate only. Pixel decoding must still succeed before display.
export function inspectPng(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length>2*1024*1024)throw new Error('Image byte limit exceeded or invalid input');
 if(buffer.length<8||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Only PNG is supported');
 let offset=8,width,height,depth,color,paletteSize=0,seenTransparency=false,seenPalette=false,seenData=false,endedData=false,ended=false,chunks=0;
 while(offset<buffer.length){
  if(++chunks>4096||buffer.length-offset<12)throw new Error('Invalid PNG chunk bounds');
  const length=buffer.readUInt32BE(offset),end=offset+12+length;
  if(end>buffer.length)throw new Error('Truncated PNG chunk');
  const type=buffer.toString('ascii',offset+4,offset+8);
  if(!buffer.subarray(offset+4,offset+8).every(b=>(b>=65&&b<=90)||(b>=97&&b<=122)))throw new Error('Invalid PNG chunk type');
  if(buffer[offset+6]&32)throw new Error('Invalid PNG reserved chunk bit');
  let crc=0xffffffff;
  for(const byte of buffer.subarray(offset+4,end-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  if(((crc^0xffffffff)>>>0)!==buffer.readUInt32BE(end-4))throw new Error('Invalid PNG CRC');
  if(chunks===1&&type!=='IHDR')throw new Error('PNG header must be first');
  if(type==='IHDR'){
   if(chunks!==1||length!==13)throw new Error('Invalid PNG header');
   width=buffer.readUInt32BE(offset+8);height=buffer.readUInt32BE(offset+12);
   if(!width||!height||width>8192||height>8192||width*height>16000000)throw new Error('Image dimensions exceed limit');
   depth=buffer[offset+16];color=buffer[offset+17];
   if(!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color]?.includes(depth))||buffer[offset+18]!==0||buffer[offset+19]!==0||buffer[offset+20]>1)throw new Error('Invalid PNG encoding');
  }else if(type==='PLTE'){
   if(seenPalette||seenTransparency||seenData||color===0||color===4||!length||length%3||length>768||(color===3&&length/3>2**depth))throw new Error('Invalid PNG palette');
   seenPalette=true;paletteSize=length/3;
  }else if(type==='tRNS'){
   if(seenTransparency||seenData||![0,2,3].includes(color)||(color===0&&length!==2)||(color===2&&length!==6)||(color===3&&(!seenPalette||!length||length>paletteSize)))throw new Error('Invalid PNG transparency');
   if(color!==3)for(let i=0;i<length;i+=2)if(buffer.readUInt16BE(offset+8+i)>=2**depth)throw new Error('Invalid PNG transparent sample');
   seenTransparency=true;
  }else if(type==='IDAT'){
   if(color===3&&!seenPalette)throw new Error('Missing PNG palette');
   if(endedData)throw new Error('Noncontiguous PNG data');seenData=true;
  }else{
   if(seenData)endedData=true;
   if(type==='IEND'){if(length||!seenData||end!==buffer.length)throw new Error('Invalid PNG end');ended=true;}
   else if(['iCCP','zTXt','iTXt'].includes(type))throw new Error('Compressed or international PNG metadata is unsupported');
   else if(['acTL','fcTL','fdAT'].includes(type))throw new Error('Animated PNG is unsupported');
   else if(type[0]===type[0].toUpperCase()&&type!=='PLTE')throw new Error('Unknown critical PNG chunk');
  }
  offset=end;
 }
 if(!ended)throw new Error('Missing PNG end');
 return {mime:'image/png',width,height,bytes:buffer.length};
}

// Stripping color metadata makes this unsuitable for color-critical review.
export async function preparePng(buffer,options){
 const metadata=await validatePng(buffer,options),parts=[buffer.subarray(0,8)];
 for(let offset=8;offset<buffer.length;){
  const length=buffer.readUInt32BE(offset),end=offset+length+12,type=buffer.toString("ascii",offset+4,offset+8);
  if(["IHDR","PLTE","tRNS","IDAT","IEND"].includes(type))parts.push(buffer.subarray(offset,end));
  offset=end;
 }
 options?.signal?.throwIfAborted();
 const data=Buffer.concat(parts);
 return {...metadata,bytes:data.length,originalBytes:metadata.bytes,data,metadataStripped:data.length!==buffer.length};
}

// Fail fast instead of retaining an unbounded queue of image buffers.
let activeValidations=0;
export async function validatePng(buffer,{signal}={}){
 signal?.throwIfAborted();
 if(activeValidations>=2)throw Object.assign(new Error('Image validation busy; retry shortly'),{code:'IMAGE_BUSY'});
 activeValidations++;
 try{return await validatePngStream(buffer,{signal});}finally{activeValidations--;}
}
async function validatePngStream(buffer,{signal}){
 signal?.throwIfAborted();
 const metadata=inspectPng(buffer);
 const depth=buffer[24],color=buffer[25];
 if(buffer[28]!==0)throw new Error('Interlaced PNG is unsupported');
 const channels={0:1,2:3,3:1,4:2,6:4}[color],stride=Math.ceil(metadata.width*channels*depth/8)+1;
 const expected=stride*metadata.height;
 if(expected>64*1024*1024)throw new Error('PNG decoded byte limit exceeded');
 const parts=[];
 for(let offset=8;offset<buffer.length;){const length=buffer.readUInt32BE(offset);if(buffer.toString('ascii',offset+4,offset+8)==='IDAT')parts.push(buffer.subarray(offset+8,offset+8+length));offset+=length+12;}
 const compressed=Buffer.concat(parts);
 const result=await inflateAsync(compressed,{maxOutputLength:expected,info:true,signal});
 signal?.throwIfAborted();
 if(result.engine.bytesWritten!==compressed.length||result.buffer.length!==expected)throw new Error('Invalid PNG decoded length');
 for(let row=0;row<metadata.height;row++)if(result.buffer[row*stride]>4)throw new Error('Invalid PNG row filter');
 return metadata;
}
