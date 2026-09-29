// Structural gate only. Pixel decoding must still succeed before display.
export function inspectPng(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length>2*1024*1024)throw new Error('Image byte limit exceeded or invalid input');
 if(buffer.length<8||!buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('Only PNG is supported');
 let offset=8,width,height,seenData=false,endedData=false,ended=false,chunks=0;
 while(offset<buffer.length){
  if(++chunks>4096||buffer.length-offset<12)throw new Error('Invalid PNG chunk bounds');
  const length=buffer.readUInt32BE(offset),end=offset+12+length;
  if(end>buffer.length)throw new Error('Truncated PNG chunk');
  const type=buffer.toString('ascii',offset+4,offset+8);
  if(!buffer.subarray(offset+4,offset+8).every(b=>(b>=65&&b<=90)||(b>=97&&b<=122)))throw new Error('Invalid PNG chunk type');
  let crc=0xffffffff;
  for(const byte of buffer.subarray(offset+4,end-4)){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  if(((crc^0xffffffff)>>>0)!==buffer.readUInt32BE(end-4))throw new Error('Invalid PNG CRC');
  if(chunks===1&&type!=='IHDR')throw new Error('PNG header must be first');
  if(type==='IHDR'){
   if(chunks!==1||length!==13)throw new Error('Invalid PNG header');
   width=buffer.readUInt32BE(offset+8);height=buffer.readUInt32BE(offset+12);
   if(!width||!height||width>8192||height>8192||width*height>16000000)throw new Error('Image dimensions exceed limit');
   const depth=buffer[offset+16],color=buffer[offset+17];
   if(!({0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]}[color]?.includes(depth))||buffer[offset+18]!==0||buffer[offset+19]!==0||buffer[offset+20]>1)throw new Error('Invalid PNG encoding');
  }else if(type==='IDAT'){
   if(endedData)throw new Error('Noncontiguous PNG data');seenData=true;
  }else{
   if(seenData)endedData=true;
   if(type==='IEND'){if(length||!seenData||end!==buffer.length)throw new Error('Invalid PNG end');ended=true;}
   else if(['acTL','fcTL','fdAT'].includes(type))throw new Error('Animated PNG is unsupported');
   else if(type[0]===type[0].toUpperCase()&&type!=='PLTE')throw new Error('Unknown critical PNG chunk');
  }
  offset=end;
 }
 if(!ended)throw new Error('Missing PNG end');
 return {mime:'image/png',width,height,bytes:buffer.length};
}
