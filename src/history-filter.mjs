// Navigation is exact and case-sensitive; unlike search it never uses oldPath.
export function selectExactHistoryPath(files,path){
 if(typeof path!=='string'||!path)return null;
 const matches=files.filter(file=>file.path===path);
 return matches.length===1&&typeof matches[0].id==='string'&&matches[0].id?matches[0].id:null;
}
export function filterLoadedCommits(commits,query=''){
 const needle=query.trim().toLowerCase();
 return needle?commits.filter(commit=>[commit.id,commit.author,commit.subject].some(value=>value?.toLowerCase().includes(needle))):commits;
}
export function filterCommitFiles(files,query=''){
 const needle=query.trim().toLowerCase();
 return needle?files.filter(file=>[file.path,file.oldPath].some(value=>value?.toLowerCase().includes(needle))):files;
}
