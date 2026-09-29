import React from 'react';
import {createRoot} from 'react-dom/client';
import HistoryGraph from '../src/HistoryGraph.jsx';
export async function checkGraph(){
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host),id=n=>n.toString(16).padStart(40,'0');let selected;
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('Graph UI timeout');};
 const commits=Array.from({length:201},(_,i)=>({id:id(i+1),parents:[id(i+2)],subject:'commit '+i}));
 try{
 root.render(<HistoryGraph commits={commits} onSelect={value=>selected=value} t={key=>key}/>);
 await wait(()=>host.querySelector('button'));if(host.querySelector('svg'))throw Error('Graph rendered before opt-in');host.querySelector('button').click();
 await wait(()=>host.querySelector('svg'));
 if(host.querySelectorAll('circle').length!==200||host.querySelectorAll('path').length!==199)throw Error('Graph bounds incorrect');
 if(!host.textContent.includes('graphLimit')||!host.textContent.includes('graphMissing'))throw Error('Missing graph scope markers');
 const node=host.querySelector('ol button');node.click();if(selected!==id(1)||node.title!==id(1))throw Error('Graph selected wrong commit');
 host.querySelector('button').click();await wait(()=>!host.querySelector('svg'));
 }finally{root.unmount();host.remove();}
}
