import React from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import HistoryGraph from '../src/HistoryGraph.jsx';
export function mount(){
 const host=document.createElement('div');host.id='native-graph';document.body.appendChild(host);
 const root=createRoot(host),id=n=>n.toString(16).padStart(40,'0');
 const state={selected:null,activations:0,trusted:[]};
 host.addEventListener('click',event=>{if(event.target.closest('ol button'))state.trusted.push(event.isTrusted);});
 flushSync(()=>root.render(<HistoryGraph commits={[{id:id(1),parents:[id(2)],subject:'first'},{id:id(2),parents:[],subject:'last'}]} onSelect={value=>{state.selected=value;state.activations++;}} t={key=>key}/>));
 flushSync(()=>host.querySelector('button').click());host.querySelector('ol button').focus();
 globalThis.nativeGraphState=state;
 return ()=>{root.unmount();host.remove();delete globalThis.nativeGraphState;};
}
