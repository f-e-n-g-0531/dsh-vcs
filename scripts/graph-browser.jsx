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
 const merge=[{id:id(4),parents:[id(3),id(2)],subject:'merge'},{id:id(3),parents:[id(1)],subject:'left'},{id:id(2),parents:[id(1)],subject:'right'},{id:id(1),parents:[],subject:'root'}];
 root.render(<HistoryGraph commits={merge} onSelect={value=>selected=value} t={key=>key}/>);
 await wait(()=>host.querySelectorAll('circle').length===4);
 if(host.querySelectorAll('path').length!==4||host.textContent.includes('graphMissing')||host.textContent.includes('graphLimit'))throw Error('Merge graph relationships incorrect');
 const curves=[...host.querySelectorAll('path')].map(path=>path.getAttribute('d'));
 const tracks=curves.map(d=>Number(d.split(' C ')[1].split(' ')[0]));
 // Edges 0 and 3 cover disjoint rows and deliberately reuse a track.
 if(tracks.join(',')!=='35,47,59,35')throw Error('Merge interval track allocation incorrect: '+tracks.join(','));
 const svg=host.querySelector('svg');if(Number(svg.getAttribute('width'))<Math.max(...tracks)+12)throw Error('Graph tracks clipped by SVG viewport');
 const buttons=host.querySelectorAll('ol button');buttons[2].click();if(selected!==id(2))throw Error('Merge branch selection incorrect');
 const relations=host.querySelectorAll('details li');if(relations.length!==4||!relations[0].textContent.includes(id(3))||!relations[1].textContent.includes(id(2)))throw Error('Merge parent text missing');
 root.render(<HistoryGraph commits={[merge[3],merge[0],merge[1],merge[2]]} onSelect={value=>selected=value} t={key=>key}/>);
 await wait(()=>host.querySelector('[role=alert]'));if(host.querySelector('svg')||!host.textContent.includes('graphInvalid'))throw Error('Invalid topology did not fall back');
 host.querySelector('button').click();await wait(()=>!host.querySelector('[role=alert]'));
 }finally{root.unmount();host.remove();}
}
