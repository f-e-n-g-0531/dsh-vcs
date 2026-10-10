// Parse only a selected path's `git ls-files --unmerged -z` records.
// Stages are Index identities, not claims about merge/rebase side ownership.
export function parseConflictStages(buffer,selectedPath){
 if(!Buffer.isBuffer(buffer)||buffer.length>2*1024*1024||typeof selectedPath!=='string'||!selectedPath||selectedPath.includes('\0'))throw Error('Invalid conflict stage input');
 const text=buffer.toString('utf8');if(!Buffer.from(text,'utf8').equals(buffer))throw Error('Invalid conflict stage encoding');
 if(!text)return [];if(!text.endsWith('\0'))throw Error('Truncated conflict stages');
 const records=text.slice(0,-1).split('\0');if(records.length>3)throw Error('Too many conflict stages');
 const seen=new Set();let width;const result=records.map(record=>{
 const tab=record.indexOf('\t');if(tab<0||record.slice(tab+1)!==selectedPath)throw Error('Conflict stage path mismatch');
 const header=/^(100644|100755|120000|160000) ([a-f0-9]{40}|[a-f0-9]{64}) ([123])$/.exec(record.slice(0,tab));if(!header)throw Error('Invalid conflict stage record');
 const [,mode,oid,rawStage]=header,stage=Number(rawStage);if(seen.has(stage)||/^0+$/.test(oid)||(width&&oid.length!==width))throw Error('Invalid conflict stage identity');seen.add(stage);width=oid.length;return {stage,mode,oid,kind:mode==='160000'?'gitlink':mode==='120000'?'symlink':'file'};
 });return result.sort((a,b)=>a.stage-b.stage);
}
