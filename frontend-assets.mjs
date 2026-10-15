import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export function registerFrontendAssets(ctx,{running,load=name=>readFile(new URL('./dist/'+name,import.meta.url))}={}){
 for(const name of ['frontend.json','interface.js'])ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/vcs-assets/'+name,async handler(req,res){
  const admission=ctx.connection.admit(req);if('rejection' in admission){res.writeHead(admission.rejection);res.end();return;}
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return;}
  try{
   let bytes=await load(name);
   if(name==='frontend.json'){const installed=JSON.parse(bytes);bytes=Buffer.from(JSON.stringify({...installed,runningBackend:running.backend}));}
   else{const hash=new URL(req.url,'http://localhost').searchParams.get('hash');if(!hash||hash!==digest(bytes)){res.writeHead(409);res.end('Frontend changed; retry reload.');return;}}
   res.writeHead(200,{'Content-Type':name.endsWith('.json')?'application/json; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch{res.writeHead(503);res.end('Frontend unavailable; retry or restart DSH.');}
 }}));
}
