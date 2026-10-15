import {mergeHistoryWindow} from './history-window.mjs';
// Reuse Git's 200-row window, keeping revision strings opaque (never Number).
export function mergeSvnHistoryWindow(previous,incoming,offset){
 const merged=mergeHistoryWindow({commits:(previous?.entries||[]).map(row=>({...row,id:row.revision}))},{...incoming,commits:incoming.entries.map(row=>({...row,id:row.revision}))},offset);
 return {...incoming,windowEnd:merged.windowEnd,entries:merged.commits.map(({id,...row})=>row)};
}
