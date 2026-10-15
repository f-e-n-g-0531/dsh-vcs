export function validateFrontend(manifest){
 if(manifest?.protocol!==1||!/^\d+\.\d+\.\d+$/.test(manifest.version)||!['backend','runningBackend','interface'].every(k=>/^[a-f0-9]{64}$/.test(manifest[k])))throw Error('Invalid frontend manifest');
 if(manifest.backend!==manifest.runningBackend)throw Object.assign(Error('Backend changed; restart DSH.'),{code:'restart-required'});
 return manifest;
}
export async function loadFrontend({base,fetcher=fetch,importer=url=>import(/* @vite-ignore */ url),signal,requireModule}){
 const url=new URL('vcs-assets/frontend.json',base);
 const response=await fetcher(url,{credentials:'same-origin',cache:'no-store',redirect:'error',signal});
 if(!response.ok)throw Error('Frontend manifest HTTP '+response.status);
 if(!response.headers.get('content-type')?.includes('application/json'))throw Error('Invalid frontend manifest Content-Type');
 const manifest=validateFrontend(await response.json());signal?.throwIfAborted();
 const resource=new URL('interface.js',url);resource.searchParams.set('hash',manifest.interface);
 const module=await importer(resource.href);signal?.throwIfAborted();
 const ui=module.default(requireModule);if(typeof ui.createPage!=='function'||!ui.dictionaries)throw Error('Invalid frontend module');
 return {ui,manifest};
}
