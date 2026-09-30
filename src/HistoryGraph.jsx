import React,{useState} from 'react';
import {buildHistoryGraph} from './history-graph.mjs';
import {routeGraphEdges} from './graph-routing.mjs';
function Graph({commits,selected,onSelect,t}){
 let graph;try{graph=buildHistoryGraph(commits);}catch{return <p role="alert">{t('graphInvalid')}</p>;}
 const routes=routeGraphEdges(graph),width=Math.max(100,48+12*Math.max(0,...routes.map(e=>e.lane))),height=Math.max(40,graph.nodes.length*36);
 return <section aria-label={t('historyGraph')}><p>{t('graphScope')}</p>
 {(graph.nodesTruncated||graph.edgesTruncated)&&<p role="status">{t('graphLimit')}</p>}
 <div style={{maxHeight:480,overflow:'auto',display:'flex'}}><svg width={width} height={height} aria-hidden="true" style={{flexShrink:0}}>
 {routes.map(edge=>{const y1=edge.start*36+18,y2=edge.end*36+18,x=35+edge.lane*12;return <path key={edge.from+edge.to} d={'M 12 '+y1+' C '+x+' '+y1+', '+x+' '+y2+', 12 '+y2} fill="none" stroke="currentColor" opacity="0.45"/>;})}
 {graph.nodes.map(n=><circle key={n.id} cx="12" cy={n.row*36+18} r="4" fill="currentColor"/>)}
 </svg><ol style={{listStyle:'none',margin:0,padding:0}}>{graph.nodes.map(n=><li key={n.id} style={{height:36,whiteSpace:'nowrap'}}><button title={n.id} aria-current={selected===n.id?true:undefined} style={selected===n.id?{fontWeight:700,textDecoration:"underline"}:undefined} onKeyDown={event=>{if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;const next=event.key==='ArrowDown'?Math.min(n.row+1,graph.nodes.length-1):event.key==='ArrowUp'?Math.max(0,n.row-1):event.key==='Home'?0:event.key==='End'?graph.nodes.length-1:null;if(next===null)return;event.preventDefault();event.stopPropagation();event.currentTarget.closest('ol').querySelectorAll('button')[next]?.focus();}} onClick={()=>onSelect(n.id)}><code>{n.id.slice(0,10)}</code> {commits[n.row].subject}</button></li>)}</ol></div>
 <details><summary>{t('graphRelations')}</summary><ul>{graph.edges.map(e=><li key={e.from+e.to}><code>{e.from}</code> → <code>{e.to}</code>{e.missing?' · '+t('graphMissing'):''}</li>)}</ul></details>
 </section>;
}
export default function HistoryGraph(props){const [open,setOpen]=useState(false);return <div><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{props.t('historyGraph')}</button>{open&&<Graph {...props}/>}</div>;}
