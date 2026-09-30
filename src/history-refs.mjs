export function indexHistoryReferences(references){
 const index=new Map();
 for(const ref of references){
  let group=index.get(ref.commit);if(!group){group={names:[],hidden:0};index.set(ref.commit,group);}
  if(group.names.length<3)group.names.push(ref.name);else group.hidden++;
 }
 return index;
}
