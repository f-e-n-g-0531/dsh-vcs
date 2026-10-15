import React,{useState,useEffect,useRef,useSyncExternalStore} from 'react';
import * as bundled from './client.jsx';
import {loadFrontend} from './frontend-loader.mjs';
import {version} from '../package.json';
import UpdatePanel from './UpdatePanel.jsx';
import {createClientRpc} from './client-rpc.mjs';
export const inject=[...bundled.inject,'remote','remote.pluginManager'];
export function apply(ctx,{loader=loadFrontend}={}){
 ctx.effect(()=>ctx.locale.register('local.vcs',bundled.dictionaries));
 const t=ctx.locale.bind('local.vcs');
 const updateRpc=createClientRpc(ctx.connection,()=>t('error'));
 class ReloadBoundary extends React.Component{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<><p role="alert">{t('reloadFailed')}</p><button onClick={this.props.restore}>{t('retry')}</button></>:this.props.children;}
 }
 function Page(props){
  useSyncExternalStore(fn=>ctx.locale.subscribe(fn),()=>ctx.locale.getSnapshot(),()=>ctx.locale.getSnapshot());
  const [generation,setGeneration]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[open,setOpen]=useState(false),[updating,setUpdating]=useState(false);
  const previous=useRef(null),view=useRef('workspace'),task=useRef(null),alive=useRef(true),lock=useRef(false);
  const [current,setCurrent]=useState(()=>({Component:bundled.createPage(ctx,{initialView:view.current,onViewChange:v=>{view.current=v;}}),version}));
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;task.current?.abort();};},[]);
  const reload=async()=>{
   if(lock.current||updating)return;lock.current=true;task.current?.abort();const controller=new AbortController();task.current=controller;setBusy(true);setNotice('');
   try{const {ui,manifest}=await loader({base:document.baseURI,signal:controller.signal,requireModule:name=>{if(name==='react')return React;throw Error('Unsupported interface dependency');}});
    if(!alive.current||controller.signal.aborted)return;
    // Locale changes are fingerprinted; retain the stable registration. 用相同字典安全切换。
    const Component=ui.createPage(ctx,{initialView:view.current,onViewChange:v=>{view.current=v;}});
    previous.current=current;setCurrent({Component,version:manifest.version});setGeneration(n=>n+1);setNotice(t('reloadDone'));
   }catch(e){if(alive.current&&!controller.signal.aborted)setNotice(t(e.code==='restart-required'?'reloadRestart':'reloadFailed')+' '+e.message);}
   finally{lock.current=false;if(alive.current&&!controller.signal.aborted)setBusy(false);}
  };
  const Component=current.Component;
  return <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0}}>
   <div style={{display:'flex',flexWrap:'wrap',gap:8,padding:8,flexShrink:0}}><span>VCS {current.version}</span><button disabled={busy||updating} onClick={()=>setOpen(v=>!v)} aria-expanded={open}>{t('updatePlugin')}</button><button disabled={busy||updating} onClick={reload}>{t(busy?'loading':'reloadInterface')}</button></div>
   {<div hidden={!open}><UpdatePanel rpc={updateRpc} manager={ctx.remote?.pluginManager} clientVersion={current.version} reloadBusy={busy} onLock={setUpdating} onManager={()=>ctx.layout.selectPanel('plugins')} t={t}/></div>}
   {notice&&<p role="status" style={{padding:'0 12px',flexShrink:0}}>{notice}</p>}
   <div style={{flex:1,minHeight:0}}><ReloadBoundary key={generation} restore={()=>{if(previous.current){setCurrent(previous.current);previous.current=null;}setGeneration(n=>n+1);}}><Component {...props}/></ReloadBoundary></div>
  </div>;
 }
 ctx.slots.inject('main',()=>ctx.slots.register({name:'main',key:'local-vcs'},Page));
 ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'local-vcs',label:()=>t('title'),order:65},()=> <span aria-hidden="true">▣</span>));
}
