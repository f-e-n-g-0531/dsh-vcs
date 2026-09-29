export function filterCommitFiles(files,query=''){
 const needle=query.trim().toLowerCase();
 return needle?files.filter(file=>[file.path,file.oldPath].some(value=>value?.toLowerCase().includes(needle))):files;
}
