// Projection of an already validated bounded graph; never fetch missing parents.
export function assignGraphLanes(graph){
 const slots=Array(32).fill(null),positions=new Map(),nodes=[],omitted=new Set();let lanesTruncated=false;
 const allocate=id=>{if(omitted.has(id))return null;let lane=slots.indexOf(id);if(lane>=0)return lane;lane=slots.indexOf(null);if(lane<0){lanesTruncated=true;omitted.add(id);return null;}slots[lane]=id;return lane;};
 const parents=new Map();for(const edge of graph.edges){if(edge.missing)continue;const list=parents.get(edge.from)||[];list.push(edge.to);parents.set(edge.from,list);}
 for(const node of graph.nodes){
  const lane=allocate(node.id);positions.set(node.id,{...node,lane});nodes.push({...node,lane});
  if(lane===null)continue;
  slots[lane]=null;
  const ids=parents.get(node.id)||[];
  for(const [i,parent] of ids.entries()){
   if(slots.includes(parent))continue;
   if(i===0&&slots[lane]===null)slots[lane]=parent;else allocate(parent);
  }
 }
 const edges=graph.edges.filter(e=>!e.missing).flatMap(edge=>{const from=positions.get(edge.from),to=positions.get(edge.to);return from.lane===null||to.lane===null?[]:[{...edge,start:from.row,end:to.row,fromLane:from.lane,toLane:to.lane}];});
 return {nodes,edges,lanesTruncated,laneCount:Math.max(1,...nodes.map(n=>(n.lane??0)+1))};
}
