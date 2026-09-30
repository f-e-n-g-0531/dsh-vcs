export function filterTreeEntries(entries,directory='',query=''){
 const prefix=directory?directory+'/':'',needle=query.toLowerCase();
 return entries.filter(entry=>{const name=entry.path.slice(prefix.length);return entry.path.startsWith(prefix)&&name.length>0&&!name.includes('/')&&name.toLowerCase().includes(needle);}).sort((a,b)=>Number(b.type==='tree')-Number(a.type==='tree')||(a.path<b.path?-1:a.path>b.path?1:0));
}
