// Preferences only; server discovery still authorizes every repository request.
const key=cwd=>'dsh-vcs:project:v1:'+cwd;
export function readProject(cwd, storage) {
  if(!cwd)return '';
  try { const value=(storage??globalThis.localStorage)?.getItem(key(cwd));return typeof value==='string'&&value.length<=1024?value:''; }catch{return '';}
}
export function saveProject(cwd,id,storage) {
  if(!cwd||!id)return;
  try{(storage??globalThis.localStorage)?.setItem(key(cwd),id);}catch{}
}
