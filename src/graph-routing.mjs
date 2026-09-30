// Input is the bounded, validated buildHistoryGraph result. Missing parents have no drawn route.
export function routeGraphEdges(graph){
 const rows=new Map(graph.nodes.map(node=>[node.id,node.row]));
 const ends=[];
 return graph.edges.filter(edge=>!edge.missing).map(edge=>{
  const start=rows.get(edge.from),end=rows.get(edge.to);
  let lane=ends.findIndex(last=>last<start);
  if(lane<0)lane=ends.length;
  ends[lane]=end;
  return {...edge,lane,start,end};
 });
}
