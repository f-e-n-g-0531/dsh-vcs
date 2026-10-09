// JPEG gets a bounded structural gate; display additionally requires browser decode.
export async function prepareRaster(buffer,{signal}={}){
 signal?.throwIfAborted();
 if(Buffer.isBuffer(buffer)&&buffer[0]===255&&buffer[1]===216){const result=prepareBaselineJpeg(buffer);signal?.throwIfAborted();return result;}
 if(Buffer.isBuffer(buffer)&&buffer.toString('ascii',0,4)==='RIFF'){const result=prepareSimpleWebp(buffer);signal?.throwIfAborted();return result;}
 return preparePng(buffer,{signal});
}
// Simple static WebP only; extended/animated containers remain rejected.
export function prepareSimpleWebp(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<26||buffer.length>2097152||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WEBP'||buffer.readUInt32LE(4)!==buffer.length-8)throw Error('Invalid WebP RIFF or byte limit');
 const kind=buffer.toString('ascii',12,16),size=buffer.readUInt32LE(16),end=20+size;if(end+(size&1)!==buffer.length||(size&1&&buffer[end]!==0))throw Error('Invalid WebP single chunk length or padding');
 let width,height;
 if(kind==='VP8 '){
  if(size<10)throw Error('Truncated WebP VP8 header');const tag=buffer.readUIntLE(20,3),partition=tag>>>5;
  if((tag&1)||((tag>>>1)&7)>3||!(tag&16)||!partition||partition>size-3||!buffer.subarray(23,26).equals(Buffer.from([157,1,42])))throw Error('Unsupported WebP VP8 frame');
  const w=buffer.readUInt16LE(26),h=buffer.readUInt16LE(28);if(w>>>14||h>>>14)throw Error('WebP scaled frame unsupported');width=w&16383;height=h&16383;
 }else if(kind==='VP8L'){
  if(size<6||buffer[20]!==47)throw Error('Invalid WebP lossless header');const bits=buffer.readUInt32LE(21);if(bits>>>29)throw Error('Unsupported WebP lossless version');width=(bits&16383)+1;height=((bits>>>14)&16383)+1;
 }else throw Error('Only simple static WebP is supported');
 if(!width||!height||width>8192||height>8192||width*height>16000000)throw Error('WebP dimensions exceed limit');
 return {mime:'image/webp',width,height,bytes:buffer.length,originalBytes:buffer.length,data:Buffer.from(buffer),metadataStripped:false};
}
export function prepareBaselineJpeg(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<4||buffer.length>2097152||buffer[0]!==255||buffer[1]!==216)throw Error('Invalid JPEG input or byte limit');
 let offset=2,segments=0,width,height,components,seenFrame=false,seenScan=false;const quant=new Set(),huffman=new Set(),frame=new Map();const parts=[buffer.subarray(0,2)];
 while(offset<buffer.length){
  if(++segments>4096||buffer[offset]!==255)throw Error('Invalid JPEG marker');const start=offset++;while(buffer[offset]===255)offset++;const marker=buffer[offset++];
  if(marker===217){if(!seenScan||offset!==buffer.length)throw Error('Invalid JPEG end');const data=Buffer.concat([...parts,Buffer.from([255,217])]);return {mime:'image/jpeg',width,height,bytes:data.length,originalBytes:buffer.length,data,metadataStripped:data.length!==buffer.length};}
  if(seenScan||![192,196,219,221,218,254,...Array.from({length:16},(_,i)=>224+i)].includes(marker)||offset+2>buffer.length)throw Error('Unsupported JPEG marker or scan');
  const length=buffer.readUInt16BE(offset),end=offset+length;if(length<2||end>buffer.length)throw Error('Truncated JPEG segment');const payload=offset+2;
  if(marker===192){if(seenFrame||length<8||buffer[payload]!==8)throw Error('Unsupported JPEG frame');height=buffer.readUInt16BE(payload+1);width=buffer.readUInt16BE(payload+3);components=buffer[payload+5];if(![1,3].includes(components)||length!==8+3*components||!width||!height||width>8192||height>8192||width*height>16000000)throw Error('JPEG dimensions or components exceed scope');for(let p=payload+6;p<end;p+=3){const component=buffer[p],sampling=buffer[p+1],table=buffer[p+2];if(frame.has(component)||!sampling||(sampling>>4)>4||!(sampling&15)||(sampling&15)>4||table>3)throw Error('Invalid JPEG component');frame.set(component,table);}seenFrame=true;}
  if(marker===219){for(let p=payload;p<end;){const info=buffer[p++];if(info>3||p+64>end)throw Error('Unsupported JPEG quantization table');if(buffer.subarray(p,p+64).includes(0))throw Error('Invalid JPEG quantization value');quant.add(info);p+=64;}}
  if(marker===196){for(let p=payload;p<end;){const info=buffer[p++];if(![0,1,2,3,16,17,18,19].includes(info)||p+16>end)throw Error('Invalid JPEG Huffman table');let count=0,slots=1;for(let n=0;n<16;n++){slots=slots*2-buffer[p+n];count+=buffer[p+n];if(slots<0)throw Error('Oversubscribed JPEG Huffman table');}p+=16;if(!count||count>256||p+count>end)throw Error('Invalid JPEG Huffman symbols');huffman.add(info);p+=count;}}
  if(marker===221&&length!==4)throw Error('Invalid JPEG restart interval');
  if(marker===218){if(!seenFrame||buffer[payload]!==components||length!==6+2*components||buffer[end-3]!==0||buffer[end-2]!==63||buffer[end-1]!==0)throw Error('Unsupported JPEG scan');const selected=new Set();for(let p=payload+1;p<end-3;p+=2){const component=buffer[p],table=buffer[p+1];if(!frame.has(component)||selected.has(component)||!quant.has(frame.get(component))||!huffman.has(table>>4)||!huffman.has(16+(table&15)))throw Error('Missing JPEG scan table or component');selected.add(component);}seenScan=true;}
  if(marker<224&&marker!==254)parts.push(buffer.subarray(start,end));offset=end;
  if(marker===218){const scanStart=offset;let bytes=0;while(offset<buffer.length){if(buffer[offset]!==255){offset++;bytes++;continue;}let next=offset+1;while(buffer[next]===255)next++;if(buffer[next]===0||(buffer[next]>=208&&buffer[next]<=215)){offset=next+1;bytes++;continue;}break;}if(!bytes)throw Error('Empty JPEG scan');parts.push(buffer.subarray(scanStart,offset));}
 }
 throw Error('Missing JPEG end');
}
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
