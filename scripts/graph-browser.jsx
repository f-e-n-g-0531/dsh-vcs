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
 root.render(<HistoryGraph commits={merge} selected={id(2)} onSelect={value=>selected=value} t={key=>key}/>);
 await wait(()=>host.querySelectorAll('circle').length===4);
 if(host.querySelectorAll('path').length!==4||host.textContent.includes('graphMissing')||host.textContent.includes('graphLimit'))throw Error('Merge graph relationships incorrect');
 const curves=[...host.querySelectorAll('path')].map(path=>path.getAttribute('d'));
 const tracks=curves.map(d=>Number(d.split(' C ')[1].split(' ')[0]));
 // Edges 0 and 3 cover disjoint rows and deliberately reuse a track.
 if(tracks.join(',')!=='35,47,59,35')throw Error('Merge interval track allocation incorrect: '+tracks.join(','));
 const svg=host.querySelector('svg');if(Number(svg.getAttribute('width'))<Math.max(...tracks)+12)throw Error('Graph tracks clipped by SVG viewport');
 const buttons=host.querySelectorAll('ol button');buttons[2].click();if(selected!==id(2))throw Error('Merge branch selection incorrect');
 buttons[0].focus();const priorSelection=selected;
 const key=(value,extra={})=>document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true,...extra}));
 key('ArrowDown');if(document.activeElement!==buttons[1])throw Error('Graph ArrowDown focus failed');
 key('End');if(document.activeElement!==buttons[3])throw Error('Graph End focus failed');
 key('ArrowDown');if(document.activeElement!==buttons[3])throw Error('Graph focus exceeded end');
 key('ArrowUp');if(document.activeElement!==buttons[2])throw Error('Graph ArrowUp focus failed');
 key('Home');if(document.activeElement!==buttons[0])throw Error('Graph Home focus failed');
 key('ArrowUp');if(document.activeElement!==buttons[0])throw Error('Graph focus exceeded start');
 for(const modifier of ['altKey','ctrlKey','metaKey','shiftKey']){
  if(!key('ArrowDown',{[modifier]:true})||document.activeElement!==buttons[0]||selected!==priorSelection)throw Error('Graph stole modified key: '+modifier);
 }
 for(const unhandled of ['Tab','Enter',' ','ArrowLeft','ArrowRight']){
  if(!key(unhandled)||document.activeElement!==buttons[0])throw Error('Graph intercepted unhandled key: '+unhandled);
 }
 if(selected!==priorSelection)throw Error('Graph focus navigation selected a commit');
 if(host.querySelectorAll('[aria-current=true]').length!==1||buttons[2].getAttribute('aria-current')!=='true')throw Error('Current graph commit was not preserved during focus navigation');
 root.render(<HistoryGraph commits={merge} selected={id(99)} onSelect={value=>selected=value} t={key=>key}/>);
 await wait(()=>!host.querySelector('[aria-current=true]'));
 const relations=host.querySelectorAll('details li');if(relations.length!==4||!relations[0].textContent.includes(id(3))||!relations[1].textContent.includes(id(2)))throw Error('Merge parent text missing');
 root.render(<HistoryGraph commits={[merge[3],merge[0],merge[1],merge[2]]} onSelect={value=>selected=value} t={key=>key}/>);
 await wait(()=>host.querySelector('[role=alert]'));if(host.querySelector('svg')||!host.textContent.includes('graphInvalid'))throw Error('Invalid topology did not fall back');
 host.querySelector('button').click();await wait(()=>!host.querySelector('[role=alert]'));
 const fork=[{id:id(1),parents:[id(2),id(3)]},{id:id(2),parents:[id(4)]},{id:id(3),parents:[id(4)]},{id:id(4),parents:[]}].map(c=>({...c,subject:'fork'}));
 root.render(<HistoryGraph commits={fork} onSelect={value=>selected=value} t={key=>key}/>);await wait(()=>host.querySelectorAll('circle').length===4);
 if(new Set([...host.querySelectorAll('circle')].map(n=>n.getAttribute('cx'))).size!==2||host.querySelectorAll('path').length!==4)throw Error('Fork does not use distinct node lanes');
 const octopus=[{id:id(1),parents:Array.from({length:40},(_,i)=>id(i+2)),subject:'octopus'},...Array.from({length:40},(_,i)=>({id:id(i+2),parents:[],subject:'branch'}))];
 root.render(<HistoryGraph commits={octopus} onSelect={value=>selected=value} t={key=>key}/>);await wait(()=>host.textContent.includes('graphLaneLimit'));
 if(Number(host.querySelector('svg').getAttribute('width'))>600||host.querySelectorAll('ol button').length!==41||host.querySelectorAll('details li').length!==40)throw Error('Overflow lanes lose bounds or textual coverage');
 }finally{root.unmount();host.remove();}
}
