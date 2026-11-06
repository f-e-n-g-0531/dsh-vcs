// Fit preserves the original intrinsic-size preview; numeric scales never fit down.
export const IMAGE_ZOOM_PERCENTAGES=Object.freeze([25,50,100,200]);
export function imageScaleStyle(width,height,scale='fit'){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>8192||height>8192||width*height>16000000)throw new RangeError('Invalid image dimensions');
 if(scale==='fit')return {maxWidth:'100%',maxHeight:480,objectFit:'contain'};
 if(!IMAGE_ZOOM_PERCENTAGES.includes(scale))throw new RangeError('Invalid image zoom');
 return {width:width*scale/100,height:height*scale/100,maxWidth:'none',maxHeight:'none',objectFit:'contain'};
}
