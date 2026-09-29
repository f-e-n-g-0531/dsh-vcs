// Local projection only: never fetch missing parents or imply full repository coverage.
export function buildHistoryGraph(commits){
 if(!Array.isArray(commits))throw new Error('Invalid graph commits');
 const selected=commits.slice(0,200),index=new Map(),nodes=[],edges=[];
 const valid=id=>typeof id==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(id);
 for(const [row,commit] of selected.entries()){
  if(!commit||!valid(commit.id)||!Array.isArray(commit.parents)||index.has(commit.id))throw new Error('Invalid graph node');
  index.set(commit.id,row);nodes.push({id:commit.id,row});
 }
 let edgesTruncated=false;
 for(const commit of selected){
  const seen=new Set();
  for(const parent of commit.parents){
   if(edges.length===1000){edgesTruncated=true;break;}
   if(!valid(parent)||parent.length!==commit.id.length||parent===commit.id||seen.has(parent))throw new Error('Invalid graph parent');
   seen.add(parent);const row=index.get(parent);
   if(row!==undefined&&row<=index.get(commit.id))throw new Error('Graph requires child-before-parent order');
   edges.push({from:commit.id,to:parent,missing:row===undefined});
  }
  if(edgesTruncated)break;
 }
 return {nodes,edges,nodesTruncated:commits.length>200,edgesTruncated};
}
