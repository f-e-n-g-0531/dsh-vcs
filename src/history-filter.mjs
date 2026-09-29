export function filterLoadedCommits(commits,query=''){
 const needle=query.trim().toLowerCase();
 return needle?commits.filter(commit=>[commit.id,commit.author,commit.subject].some(value=>value?.toLowerCase().includes(needle))):commits;
}
export function filterCommitFiles(files,query=''){
 const needle=query.trim().toLowerCase();
 return needle?files.filter(file=>[file.path,file.oldPath].some(value=>value?.toLowerCase().includes(needle))):files;
}
