// Check authenticated asset responses before import, preserving same-origin security.
export async function loadEditor(url, {signal, fetcher=fetch, importer=url=>import(/* @vite-ignore */ url)}={}) {
 const response=await fetcher(url,{method:'HEAD',credentials:'same-origin',cache:'no-cache',signal});
 if(!response.ok)throw new Error('Editor resource HTTP '+response.status+' ('+url+'). '+(response.status===401?'Refresh the authenticated DSH page.':response.status===404?'The editor route is not active in this DSH process.':'Check plugin asset registration.'));
 const mime=response.headers.get('content-type')||'';
 if(!/(?:java|ecma)script/i.test(mime))throw new Error('Editor resource returned '+(mime||'no Content-Type')+' instead of JavaScript.');
  // Import retains the worker's base URL without a second body download.
  signal?.throwIfAborted();
 return importer(url);
}
