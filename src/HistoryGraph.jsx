import React,{useState} from 'react';
import {buildHistoryGraph} from './history-graph.mjs';
function Graph({commits,onSelect,t}){
 let graph;try{graph=buildHistoryGraph(commits);}catch{return <p role="alert">{t('graphInvalid')}</p>;}
 const rows=new Map(graph.nodes.map(n=>[n.id,n.row])),height=Math.max(40,graph.nodes.length*36);
 return <section aria-label={t('historyGraph')}><p>{t('graphScope')}</p>
 {(graph.nodesTruncated||graph.edgesTruncated)&&<p role="status">{t('graphLimit')}</p>}
 <div style={{maxHeight:480,overflow:'auto',display:'flex'}}><svg width="100" height={height} aria-hidden="true" style={{flexShrink:0}}>
 {graph.edges.filter(e=>!e.missing).map((edge,i)=>{const y1=rows.get(edge.from)*36+18,y2=rows.get(edge.to)*36+18,x=35+(i%5)*12;return <path key={edge.from+edge.to} d={'M 12 '+y1+' C '+x+' '+y1+', '+x+' '+y2+', 12 '+y2} fill="none" stroke="currentColor" opacity="0.45"/>;})}
 {graph.nodes.map(n=><circle key={n.id} cx="12" cy={n.row*36+18} r="4" fill="currentColor"/>)}
 </svg><ol style={{listStyle:'none',margin:0,padding:0}}>{graph.nodes.map(n=><li key={n.id} style={{height:36,whiteSpace:'nowrap'}}><button title={n.id} onClick={()=>onSelect(n.id)}><code>{n.id.slice(0,10)}</code> {commits[n.row].subject}</button></li>)}</ol></div>
 <details><summary>{t('graphRelations')}</summary><ul>{graph.edges.map(e=><li key={e.from+e.to}><code>{e.from}</code> → <code>{e.to}</code>{e.missing?' · '+t('graphMissing'):''}</li>)}</ul></details>
 </section>;
}
export default function HistoryGraph(props){const [open,setOpen]=useState(false);return <div><button aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{props.t('historyGraph')}</button>{open&&<Graph {...props}/>}</div>;}
